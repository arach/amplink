import { DurableObject } from "cloudflare:workers";

const RELAY_ROOM_TTL_SECONDS = 60 * 60 * 12;
const ACTIVE_BRIDGE_STORAGE_KEY = "active-bridge";
const ACTIVE_CLIENT_STORAGE_KEY = "active-client";

interface RelaySocketMeta {
  roomId: string;
  role: "bridge" | "client";
  connectionId: string;
  bridgePublicKey?: string;
  connectedAt: string;
}

export class AmplinkRelayRoom extends DurableObject<CloudflareEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/connect") {
      return json({ error: "Unknown relay route." }, 404);
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const roomId = url.searchParams.get("room")?.trim();
    const role = url.searchParams.get("role")?.trim();
    const bridgePublicKey = url.searchParams.get("key")?.trim();
    const connectionId = crypto.randomUUID();

    if (!roomId) {
      return json({ error: "room query parameter is required." }, 400);
    }

    if (role !== "bridge" && role !== "client") {
      return json({ error: "role must be bridge or client." }, 400);
    }

    if (role === "bridge" && !bridgePublicKey) {
      return json({ error: "bridge key is required." }, 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (role === "bridge") {
      for (const socket of this.ctx.getWebSockets("bridge")) {
        try {
          socket.close(4001, "replaced by new bridge");
        } catch {
          // Ignore close races.
        }
      }

      await this.ctx.storage.put(ACTIVE_BRIDGE_STORAGE_KEY, connectionId);
      await this.env.AMPLINK_DESKTOPS.put(
        bridgeRoomKey(bridgePublicKey!),
        roomId,
        { expirationTtl: RELAY_ROOM_TTL_SECONDS },
      );
    } else {
      for (const socket of this.ctx.getWebSockets("client")) {
        try {
          socket.close(4002, "replaced by new client");
        } catch {
          // Ignore close races.
        }
      }

      await this.ctx.storage.put(ACTIVE_CLIENT_STORAGE_KEY, connectionId);
    }

    server.serializeAttachment({
      roomId,
      role,
      connectionId,
      bridgePublicKey: bridgePublicKey || undefined,
      connectedAt: new Date().toISOString(),
    } satisfies RelaySocketMeta);
    this.ctx.acceptWebSocket(server, [role]);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const meta = this.getSocketMeta(ws);
    if (!meta) {
      return;
    }

    if (meta.role === "bridge") {
      if (!(await this.isActiveConnection(meta))) {
        console.log("[relay-room] ignoring stale bridge frame", {
          roomId: meta.roomId,
          connectionId: meta.connectionId,
        });
        return;
      }

      for (const client of this.ctx.getWebSockets("client")) {
        if (client === ws) {
          continue;
        }
        client.send(message);
      }
      return;
    }

    if (!(await this.isActiveConnection(meta))) {
      console.log("[relay-room] ignoring stale client frame", {
        roomId: meta.roomId,
        connectionId: meta.connectionId,
      });
      return;
    }

    const bridge = this.ctx.getWebSockets("bridge")[0];
    bridge?.send(message);
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const meta = this.getSocketMeta(ws);
    if (!meta) {
      return;
    }

    const isActive = await this.isActiveConnection(meta);

    if (meta.role === "bridge" && meta.bridgePublicKey) {
      if (isActive) {
        await this.ctx.storage.delete(ACTIVE_BRIDGE_STORAGE_KEY);
        await this.env.AMPLINK_DESKTOPS.delete(bridgeRoomKey(meta.bridgePublicKey));
        for (const client of this.ctx.getWebSockets("client")) {
          try {
            client.close(4004, "bridge absent");
          } catch {
            // Ignore close races.
          }
        }
      }
    } else if (meta.role === "client" && isActive) {
      await this.ctx.storage.delete(ACTIVE_CLIENT_STORAGE_KEY);
    }

    console.log("[relay-room] socket closed", {
      roomId: meta.roomId,
      role: meta.role,
      code,
      reason,
    });
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = this.getSocketMeta(ws);
    console.error("[relay-room] websocket error", {
      roomId: meta?.roomId,
      role: meta?.role,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private getSocketMeta(ws: WebSocket): RelaySocketMeta | null {
    const attachment = ws.deserializeAttachment();
    if (
      typeof attachment === "object" &&
      attachment !== null &&
      typeof (attachment as RelaySocketMeta).roomId === "string" &&
      ((attachment as RelaySocketMeta).role === "bridge" ||
        (attachment as RelaySocketMeta).role === "client")
    ) {
      return attachment as RelaySocketMeta;
    }

    return null;
  }

  private async isActiveConnection(meta: RelaySocketMeta): Promise<boolean> {
    const storageKey =
      meta.role === "bridge" ? ACTIVE_BRIDGE_STORAGE_KEY : ACTIVE_CLIENT_STORAGE_KEY;
    const activeConnectionId = await this.ctx.storage.get<string>(storageKey);
    return activeConnectionId === meta.connectionId;
  }
}

export function bridgeRoomKey(bridgePublicKey: string): string {
  return `relay-room:${bridgePublicKey}`;
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
