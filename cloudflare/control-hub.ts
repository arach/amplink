import { DurableObject } from "cloudflare:workers";

import type {
  ControlSocketMessage,
  DesktopDispatchEnvelope,
  DesktopTaskMessage,
  DesktopTaskResultMessage,
} from "../src/protocol/index.ts";

interface ControlSocketMeta {
  token: string;
  connectedAt: string;
}

export class AmplinkControlHub extends DurableObject<CloudflareEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      return this.handleConnect(request, url);
    }

    if (url.pathname === "/dispatch" && request.method === "POST") {
      return this.handleDispatch(request);
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return json({
        ok: true,
        listeners: this.ctx.getWebSockets("desktop").length,
      });
    }

    return json({ error: "Unknown control hub route." }, 404);
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      return;
    }

    const payload = safeParse<ControlSocketMessage>(message);
    if (!payload) {
      this.sendJson(ws, {
        type: "pong",
        at: new Date().toISOString(),
      });
      return;
    }

    if (payload.type === "ping") {
      this.sendJson(ws, {
        type: "pong",
        at: new Date().toISOString(),
      });
      return;
    }

    if (payload.type === "listener.hello") {
      console.log("[control-hub] desktop listener hello", {
        bridgeUrl: payload.bridgeUrl,
        desktopId: payload.desktopId,
      });
      return;
    }

    if (payload.type === "task.result") {
      await this.ctx.storage.put(`result:${payload.taskId}`, payload);
      await this.forwardTaskResultToSession(payload);
      console.log("[control-hub] task result", {
        taskId: payload.taskId,
        sessionId: payload.sessionId,
        status: payload.status,
      });
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const meta = this.getSocketMeta(ws);
    console.log("[control-hub] desktop listener disconnected", {
      token: meta?.token,
      code,
      reason,
    });
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = this.getSocketMeta(ws);
    console.error("[control-hub] desktop listener websocket error", {
      token: meta?.token,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private async handleConnect(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const token = url.searchParams.get("token")?.trim();
    if (!token) {
      return json({ error: "token query parameter is required." }, 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Keep one active desktop listener per token/channel to avoid split-brain
    // dispatch behavior.
    for (const socket of this.ctx.getWebSockets("desktop")) {
      try {
        socket.close(1012, "superseded by a newer desktop listener");
      } catch {
        // Ignore close races.
      }
    }

    server.serializeAttachment({
      token,
      connectedAt: new Date().toISOString(),
    } satisfies ControlSocketMeta);
    this.ctx.acceptWebSocket(server, ["desktop"]);

    this.sendJson(server, {
      type: "listener.ready",
      connectedAt: new Date().toISOString(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleDispatch(request: Request): Promise<Response> {
    const payload = safeParse<DesktopDispatchEnvelope>(await request.text());
    if (!payload) {
      return json({ error: "Invalid dispatch payload." }, 400);
    }

    const listeners = this.ctx.getWebSockets("desktop");
    const listener = listeners[0];
    if (!listener) {
      return json(
        {
          queued: false,
          error: "No desktop listener is currently connected.",
        },
        503,
      );
    }

    const task: DesktopTaskMessage = {
      type: "task",
      taskId: crypto.randomUUID(),
      sessionId: payload.voiceSessionId ?? payload.sessionId,
      userId: payload.userId,
      prompt: payload.prompt,
      target: payload.target,
      targetSessionId: payload.targetSessionId,
      quickReply: payload.quickReply,
      intent: payload.intent,
      history: payload.history,
      requestedAt: payload.requestedAt,
    };

    console.log("[control-hub] dispatch queued", {
      taskId: task.taskId,
      sessionId: task.sessionId,
      intent: task.intent.intent,
      shouldDispatch: task.intent.shouldDispatch,
      listeners: listeners.length,
    });

    this.sendJson(listener, task);
    await this.ctx.storage.put(`task:${task.taskId}`, task);

    return json(
      {
        queued: true,
        taskId: task.taskId,
        listeners: listeners.length,
      },
      202,
    );
  }

  private getSocketMeta(ws: WebSocket): ControlSocketMeta | null {
    const attachment = ws.deserializeAttachment();
    if (
      typeof attachment === "object" &&
      attachment !== null &&
      typeof (attachment as ControlSocketMeta).token === "string" &&
      typeof (attachment as ControlSocketMeta).connectedAt === "string"
    ) {
      return attachment as ControlSocketMeta;
    }

    return null;
  }

  private sendJson(ws: WebSocket, payload: ControlSocketMessage): void {
    ws.send(JSON.stringify(payload));
  }

  private async forwardTaskResultToSession(
    payload: DesktopTaskResultMessage,
  ): Promise<void> {
    const sessionId = payload.sessionId?.trim();
    if (!sessionId) {
      return;
    }

    try {
      const durableObjectId = this.env.AMPLINK_SESSION.idFromName(sessionId);
      const stub = this.env.AMPLINK_SESSION.get(durableObjectId);
      const notifyUrl = new URL("https://amplink-session.internal/task-result");
      notifyUrl.searchParams.set("session", sessionId);

      await stub.fetch(
        new Request(notifyUrl.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      );
    } catch (error) {
      console.error("[control-hub] failed to forward task result", {
        taskId: payload.taskId,
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
