// Plexus relay — lightweight WebSocket forwarder.
//
// The relay knows nothing about Plexus primitives, adapters, or sessions.
// It maintains "rooms" identified by a room ID.  Each room has one bridge
// and any number of phone clients.  Messages from the bridge are broadcast
// to all clients; messages from clients are forwarded to the bridge.
//
// All payloads are opaque — the relay forwards them verbatim.  When E2E
// encryption is added, the relay sees only ciphertext.

import type { ServerWebSocket } from "bun";

interface Room {
  bridge: ServerWebSocket<SocketData> | null;
  clients: Set<ServerWebSocket<SocketData>>;
  /** Grace timer — keeps the room alive briefly after the bridge disconnects. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface SocketData {
  roomId: string;
  role: "bridge" | "client";
}

const BRIDGE_ABSENCE_GRACE_MS = 30_000;
const ROOM_IDLE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function startRelay(port: number): { stop: () => void } {
  const rooms = new Map<string, Room>();

  const server = Bun.serve<SocketData>({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      const roomId = url.searchParams.get("room");
      const role = url.searchParams.get("role") as "bridge" | "client" | null;

      if (!roomId || !role || !["bridge", "client"].includes(role)) {
        return new Response("Missing ?room=ID&role=bridge|client", { status: 400 });
      }

      const upgraded = server.upgrade(req, { data: { roomId, role } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
    },

    websocket: {
      open(ws) {
        const { roomId, role } = ws.data;
        let room = rooms.get(roomId);

        if (!room) {
          room = { bridge: null, clients: new Set() };
          rooms.set(roomId, room);
        }

        // Clear any pending cleanup — someone joined.
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = undefined;
        }

        if (role === "bridge") {
          if (room.bridge) {
            // Replace stale bridge connection.
            room.bridge.close(4001, "Replaced by new bridge");
          }
          room.bridge = ws;
          console.log(`[relay] bridge joined room ${roomId}`);
        } else {
          room.clients.add(ws);
          console.log(`[relay] client joined room ${roomId} (${room.clients.size} clients)`);
        }
      },

      message(ws, data) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) return;

        if (role === "bridge") {
          // Bridge → all clients.
          for (const client of room.clients) {
            client.send(data);
          }
        } else {
          // Client → bridge.
          room.bridge?.send(data);
        }
      },

      close(ws) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) return;

        if (role === "bridge") {
          if (room.bridge === ws) {
            room.bridge = null;
            console.log(`[relay] bridge left room ${roomId}`);

            // Grace period — keep room alive for reconnect.
            room.cleanupTimer = setTimeout(() => {
              // Notify clients that the bridge is gone.
              for (const client of room.clients) {
                client.close(4004, "Bridge absent");
              }
              rooms.delete(roomId);
              console.log(`[relay] room ${roomId} cleaned up (bridge absent)`);
            }, BRIDGE_ABSENCE_GRACE_MS);
          }
        } else {
          room.clients.delete(ws);
          console.log(`[relay] client left room ${roomId} (${room.clients.size} clients)`);

          // If room is empty (no bridge, no clients), schedule cleanup.
          if (!room.bridge && room.clients.size === 0) {
            room.cleanupTimer = setTimeout(() => {
              rooms.delete(roomId);
              console.log(`[relay] room ${roomId} cleaned up (idle)`);
            }, ROOM_IDLE_TIMEOUT_MS);
          }
        }
      },
    },
  });

  console.log(`[relay] listening on ws://localhost:${port}`);

  return {
    stop() {
      // Clean up all rooms.
      for (const [, room] of rooms) {
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        room.bridge?.close(1001, "Relay shutting down");
        for (const client of room.clients) {
          client.close(1001, "Relay shutting down");
        }
      }
      rooms.clear();
      server.stop();
    },
  };
}
