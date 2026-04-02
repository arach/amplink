import { handleControlRequest, resolveUserId } from "./control.ts";
import { handleRelayRequest } from "./relay.ts";
import { handleVoiceAdminRequest } from "./voice-admin.ts";

interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  metadata: string;
}

interface StartSessionBody {
  userId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export async function handleWorkerFetch(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  const voiceAdminResponse = await handleVoiceAdminRequest(request, env);
  if (voiceAdminResponse) {
    return voiceAdminResponse;
  }

  const controlResponse = await handleControlRequest(request, env);
  if (controlResponse) {
    return controlResponse;
  }

  const relayResponse = await handleRelayRequest(request, env);
  if (relayResponse) {
    return relayResponse;
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return json({
      name: "amplink-cloudflare",
      routes: [
        "GET /sessions",
        "POST /start-session",
        "GET /ws?session={id}&device=mobile",
        "GET /listen?token={token}",
        "GET /relay?room={id}&role=bridge|client",
        "POST /relay/resolve",
        "POST /control/register",
        "GET /control/desktop",
        "GET /admin",
        "GET /api/voice-profile",
        "PUT /api/voice-profile",
        "POST /api/voice-preview",
      ],
    });
  }

  if (request.method === "GET" && url.pathname === "/sessions") {
    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");
    const sessions = await listSessions(env.DB, userId);
    return json({ userId, sessions });
  }

  if (request.method === "POST" && url.pathname === "/start-session") {
    const body = await readJson<StartSessionBody>(request);
    const userId = resolveUserId(
      request,
      env.AMPLINK_DEFAULT_USER || "anonymous",
      body ?? undefined,
    );
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const title = body?.title?.trim() || `Voice session ${now}`;
    const metadata = {
      source: "cloudflare-voice",
      ...body?.metadata,
    };

    await env.DB
      .prepare(
        `INSERT INTO amplink_sessions
         (id, user_id, title, status, created_at, updated_at, last_message_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sessionId,
        userId,
        title,
        "created",
        now,
        now,
        null,
        JSON.stringify(metadata),
      )
      .run();

    return json(
      {
        session: {
          id: sessionId,
          userId,
          title,
          status: "created",
          createdAt: now,
          updatedAt: now,
          lastMessageAt: null,
          metadata,
        },
        websocketUrl: buildWebSocketUrl(url, sessionId, userId),
      },
      201,
    );
  }

  if (request.method === "GET" && url.pathname === "/ws") {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const sessionId = url.searchParams.get("session")?.trim();
    const device = url.searchParams.get("device")?.trim() || "mobile";
    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");

    if (!sessionId) {
      return json({ error: "session query parameter is required." }, 400);
    }

    if (device !== "mobile") {
      return json({ error: `Unsupported device "${device}".` }, 400);
    }

    const session = await getSession(env.DB, sessionId);
    if (!session || session.user_id !== userId) {
      return json({ error: "Session not found." }, 404);
    }

    const durableObjectId = env.AMPLINK_SESSION.idFromName(sessionId);
    const stub = env.AMPLINK_SESSION.get(durableObjectId);
    const durableUrl = new URL("https://amplink-session.internal/connect");
    durableUrl.searchParams.set("session", sessionId);
    durableUrl.searchParams.set("device", device);
    durableUrl.searchParams.set("user", userId);

    return stub.fetch(new Request(durableUrl.toString(), request));
  }

  return json({ error: "Route not found." }, 404);
}

async function listSessions(
  db: D1Database,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT id, user_id, title, status, created_at, updated_at, last_message_at, metadata
       FROM amplink_sessions
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<SessionRow>();

  return result.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    metadata: safeParse<Record<string, unknown>>(row.metadata) || {},
  }));
}

async function getSession(
  db: D1Database,
  sessionId: string,
): Promise<SessionRow | null> {
  const result = await db
    .prepare(
      `SELECT id, user_id, title, status, created_at, updated_at, last_message_at, metadata
       FROM amplink_sessions
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(sessionId)
    .first<SessionRow>();

  return result ?? null;
}

async function readJson<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  const text = await request.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}

function buildWebSocketUrl(url: URL, sessionId: string, userId: string): string {
  const wsUrl = new URL(url.origin);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = "/ws";
  wsUrl.searchParams.set("session", sessionId);
  wsUrl.searchParams.set("device", "mobile");
  wsUrl.searchParams.set("user", userId);
  return wsUrl.toString();
}

function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
