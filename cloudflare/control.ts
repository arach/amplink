import type { Prompt } from "../src/protocol/primitives.ts";

const DEFAULT_REGISTRATION_TTL_SECONDS = 60 * 60 * 12;

export interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export type VoiceIntent = "command" | "question" | "status" | "smalltalk" | "dictation";

export interface VoiceIntentResult {
  intent: VoiceIntent;
  reply: string;
  shouldDispatch: boolean;
  dispatchPrompt: string;
  confidence: number;
}

export interface DesktopRegistration {
  userId: string;
  endpoint: string;
  desktopId?: string;
  sessionId?: string;
  registeredAt: string;
}

export interface DesktopDispatchEnvelope {
  source: "cloudflare-voice";
  sessionId: string;
  userId: string;
  prompt: Prompt;
  quickReply: string;
  intent: VoiceIntentResult;
  history: ConversationEntry[];
  requestedAt: string;
}

export interface DesktopDispatchResult {
  queued: boolean;
  endpoint?: string;
  status?: number;
  skipped?: boolean;
  error?: string;
}

interface DesktopRegistrationInput {
  userId?: string;
  endpoint: string;
  desktopId?: string;
  sessionId?: string;
  ttlSeconds?: number;
}

interface DesktopLookupResponse {
  registration: DesktopRegistration | null;
}

export function resolveUserId(
  request: Request,
  fallbackUserId = "anonymous",
  body?: { userId?: string | null },
): string {
  const url = new URL(request.url);
  const userId =
    body?.userId ??
    url.searchParams.get("user") ??
    request.headers.get("x-plexus-user") ??
    request.headers.get("x-user-id") ??
    fallbackUserId;

  return userId.trim() || fallbackUserId;
}

export async function handleControlRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/control")) {
    return null;
  }

  if (!isControlAuthorized(request, env)) {
    return json({ error: "Unauthorized control request." }, 401);
  }

  if (!env.PLEXUS_DESKTOPS) {
    return json(
      { error: "PLEXUS_DESKTOPS KV binding is required for control routes." },
      503,
    );
  }

  if (request.method === "POST" && url.pathname === "/control/register") {
    const body = await readJson<DesktopRegistrationInput>(request);
    if (!body?.endpoint?.trim()) {
      return json({ error: "endpoint is required." }, 400);
    }

    let endpoint: URL;
    try {
      endpoint = new URL(body.endpoint);
    } catch {
      return json({ error: "endpoint must be a valid absolute URL." }, 400);
    }

    const userId = resolveUserId(request, env.PLEXUS_DEFAULT_USER || "anonymous", body);
    const ttlSeconds = clampTtl(body.ttlSeconds);
    const registration: DesktopRegistration = {
      userId,
      endpoint: endpoint.toString(),
      desktopId: body.desktopId?.trim() || undefined,
      sessionId: body.sessionId?.trim() || undefined,
      registeredAt: new Date().toISOString(),
    };

    await env.PLEXUS_DESKTOPS.put(
      desktopUserKey(userId),
      JSON.stringify(registration),
      { expirationTtl: ttlSeconds },
    );

    if (registration.sessionId) {
      await env.PLEXUS_DESKTOPS.put(
        desktopSessionKey(registration.sessionId),
        JSON.stringify(registration),
        { expirationTtl: ttlSeconds },
      );
    }

    return json({
      ok: true,
      registration,
      ttlSeconds,
    });
  }

  if (request.method === "DELETE" && url.pathname === "/control/register") {
    const body = await readJson<{ sessionId?: string; userId?: string }>(request, true);
    const sessionId = body?.sessionId?.trim() || url.searchParams.get("session")?.trim();
    const userId = body?.userId?.trim() || url.searchParams.get("user")?.trim();

    if (!sessionId && !userId) {
      return json({ error: "userId or sessionId is required." }, 400);
    }

    if (sessionId) {
      await env.PLEXUS_DESKTOPS.delete(desktopSessionKey(sessionId));
    }

    if (userId) {
      await env.PLEXUS_DESKTOPS.delete(desktopUserKey(userId));
    }

    return json({ ok: true, sessionId: sessionId || null, userId: userId || null });
  }

  if (request.method === "GET" && url.pathname === "/control/desktop") {
    const sessionId = url.searchParams.get("session")?.trim() || undefined;
    const userId = resolveUserId(request, env.PLEXUS_DEFAULT_USER || "anonymous");
    const registration = await lookupDesktopRegistration(env, sessionId, userId);
    const response: DesktopLookupResponse = { registration };
    return json(response);
  }

  return json({ error: "Unknown control route." }, 404);
}

export async function dispatchToDesktop(
  env: CloudflareEnv,
  envelope: DesktopDispatchEnvelope,
): Promise<DesktopDispatchResult> {
  const registration = await lookupDesktopRegistration(
    env,
    envelope.sessionId,
    envelope.userId,
  );
  const endpoint = registration?.endpoint || env.DESKTOP_DISPATCH_URL?.trim();

  if (!endpoint) {
    return {
      queued: false,
      skipped: true,
      error: "No desktop dispatch endpoint is registered yet.",
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildDispatchHeaders(env),
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      return {
        queued: false,
        endpoint,
        status: response.status,
        error: `Desktop dispatch rejected the request (${response.status}).`,
      };
    }

    return {
      queued: true,
      endpoint,
      status: response.status,
    };
  } catch (error) {
    return {
      queued: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function lookupDesktopRegistration(
  env: CloudflareEnv,
  sessionId: string | undefined,
  userId: string,
): Promise<DesktopRegistration | null> {
  if (!env.PLEXUS_DESKTOPS) {
    return null;
  }

  if (sessionId) {
    const scoped = await env.PLEXUS_DESKTOPS.get(desktopSessionKey(sessionId));
    if (scoped) {
      return safeParse<DesktopRegistration>(scoped);
    }
  }

  const shared = await env.PLEXUS_DESKTOPS.get(desktopUserKey(userId));
  return shared ? safeParse<DesktopRegistration>(shared) : null;
}

function buildDispatchHeaders(env: CloudflareEnv): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-plexus-source": "cloudflare-voice",
  });

  if (env.CONTROL_SHARED_SECRET?.trim()) {
    headers.set("authorization", `Bearer ${env.CONTROL_SHARED_SECRET}`);
  }

  return headers;
}

function isControlAuthorized(request: Request, env: CloudflareEnv): boolean {
  if (!env.CONTROL_SHARED_SECRET?.trim()) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${env.CONTROL_SHARED_SECRET}`;
}

function desktopUserKey(userId: string): string {
  return `desktop:user:${userId}`;
}

function desktopSessionKey(sessionId: string): string {
  return `desktop:session:${sessionId}`;
}

function clampTtl(ttlSeconds?: number): number {
  if (!Number.isFinite(ttlSeconds)) {
    return DEFAULT_REGISTRATION_TTL_SECONDS;
  }

  return Math.max(60, Math.min(Number(ttlSeconds), 60 * 60 * 24 * 7));
}

async function readJson<T>(
  request: Request,
  allowEmpty = false,
): Promise<T | null> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return allowEmpty ? null : ({} as T);
  }

  const text = await request.text();
  if (!text.trim()) {
    return allowEmpty ? null : ({} as T);
  }

  return JSON.parse(text) as T;
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
