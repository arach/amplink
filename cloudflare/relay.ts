import { bridgeRoomKey } from "./relay-room.ts";

interface ResolveRequestBody {
  bridgePublicKey?: string;
}

export async function handleRelayRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/relay/resolve") {
    return handleResolve(request, env);
  }

  if (request.method === "GET" && url.pathname === "/relay") {
    return await handleConnect(request, env, url);
  }

  return null;
}

async function handleResolve(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  const body = await readJson<ResolveRequestBody>(request);
  const bridgePublicKey = body?.bridgePublicKey?.trim();
  if (!bridgePublicKey) {
    return json({ error: "bridgePublicKey is required." }, 400);
  }

  const roomId = await env.AMPLINK_DESKTOPS.get(bridgeRoomKey(bridgePublicKey), "text");
  if (!roomId || typeof roomId !== "string") {
    return json({ error: "bridge not found" }, 404);
  }

  console.log("[relay] resolved bridge", {
    bridgePublicKey: `${bridgePublicKey.slice(0, 12)}...`,
    roomId,
  });

  return json({ room: roomId });
}

async function handleConnect(
  request: Request,
  env: CloudflareEnv,
  url: URL,
): Promise<Response> {
  if (!env.AMPLINK_RELAY_ROOM) {
    return json({ error: "AMPLINK_RELAY_ROOM Durable Object binding is required." }, 503);
  }

  if (request.headers.get("upgrade") !== "websocket") {
    return json({ error: "Expected a WebSocket upgrade request." }, 426);
  }

  const roomId = url.searchParams.get("room")?.trim();
  const role = url.searchParams.get("role")?.trim();
  const bridgePublicKey = url.searchParams.get("key")?.trim();

  if (!roomId) {
    return json({ error: "room query parameter is required." }, 400);
  }

  if (role !== "bridge" && role !== "client") {
    return json({ error: "role must be bridge or client." }, 400);
  }

  const durableObjectId = env.AMPLINK_RELAY_ROOM.idFromName(roomId);
  const stub = env.AMPLINK_RELAY_ROOM.get(durableObjectId);
  const relayUrl = new URL("https://amplink-relay.internal/connect");
  relayUrl.searchParams.set("room", roomId);
  relayUrl.searchParams.set("role", role);
  if (bridgePublicKey) {
    relayUrl.searchParams.set("key", bridgePublicKey);
  }

  return await stub.fetch(new Request(relayUrl.toString(), request));
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
