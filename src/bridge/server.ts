// Bridge WebSocket server.
//
// Exposes the bridge over a local WebSocket so the relay (or a direct LAN
// connection from the phone) can send prompts and receive Plexus events.
//
// Wire protocol: newline-delimited JSON.
//   Inbound (phone → bridge):  JSON-RPC requests
//   Outbound (bridge → phone): Plexus events + JSON-RPC responses

import type { Bridge } from "./bridge.ts";
import type { Prompt } from "../protocol/index.ts";

interface RPCRequest {
  id: string;
  method: string;
  params?: unknown;
}

interface RPCResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export function startBridgeServer(bridge: Bridge, port: number): { stop: () => void } {
  const server = Bun.serve({
    port,
    fetch(req, server) {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("Plexus bridge. Connect via WebSocket.", { status: 200 });
      }
    },
    websocket: {
      open(ws) {
        console.log("[bridge] client connected");

        // Push all existing sessions on connect.
        for (const session of bridge.listSessions()) {
          ws.send(JSON.stringify({ event: "session:update", session }));
        }

        // Subscribe to all future events.
        const unsub = bridge.onEvent((event) => {
          ws.send(JSON.stringify(event));
        });

        // Stash unsub so we can clean up on close.
        (ws as any).__unsub = unsub;
      },

      message(ws, raw) {
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        let req: RPCRequest;
        try {
          req = JSON.parse(text);
        } catch {
          ws.send(JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }));
          return;
        }

        handleRPC(bridge, req).then((res) => {
          ws.send(JSON.stringify(res));
        });
      },

      close(ws) {
        console.log("[bridge] client disconnected");
        (ws as any).__unsub?.();
      },
    },
  });

  console.log(`[bridge] listening on ws://localhost:${port}`);

  return {
    stop() {
      server.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// RPC dispatcher — thin mapping from JSON-RPC methods to bridge calls
// ---------------------------------------------------------------------------

async function handleRPC(bridge: Bridge, req: RPCRequest): Promise<RPCResponse> {
  try {
    switch (req.method) {
      case "session/create": {
        const p = req.params as { adapterType: string; name?: string; cwd?: string; options?: Record<string, unknown> };
        const session = await bridge.createSession(p.adapterType, {
          name: p.name,
          cwd: p.cwd,
          options: p.options,
        });
        return { id: req.id, result: session };
      }

      case "session/list": {
        return { id: req.id, result: bridge.listSessions() };
      }

      case "session/close": {
        const p = req.params as { sessionId: string };
        await bridge.closeSession(p.sessionId);
        return { id: req.id, result: { ok: true } };
      }

      case "prompt/send": {
        const prompt = req.params as Prompt;
        bridge.send(prompt);
        return { id: req.id, result: { ok: true } };
      }

      case "turn/interrupt": {
        const p = req.params as { sessionId: string };
        bridge.interrupt(p.sessionId);
        return { id: req.id, result: { ok: true } };
      }

      default:
        return { id: req.id, error: { code: -32601, message: `Unknown method: ${req.method}` } };
    }
  } catch (err: any) {
    return { id: req.id, error: { code: -32000, message: err.message ?? "Internal error" } };
  }
}
