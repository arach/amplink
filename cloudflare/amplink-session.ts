import { DurableObject } from "cloudflare:workers";

import type { DesktopTaskResultMessage } from "../src/protocol/index.ts";
import { dispatchToDesktop, type ConversationEntry } from "./control.ts";
import {
  createKvTtsCache,
  createElevenLabsTtsSynthesizer,
  createWorkersAiIntentAnalyzer,
  createWorkersAiResultSummarizer,
  parseIncomingVoiceMessage,
  runVoiceTurn,
  shouldSynthesizeVoiceStage,
  type VoiceSocketMeta,
} from "./voice-core.ts";
import {
  applyVoiceProfileToOverlay,
  buildVoiceStyleGuide,
  loadVoiceProfile,
  type VoiceProfile,
} from "./voice-profile.ts";

const SESSION_VOICE_PROFILE_STORAGE_KEY = "voice-profile";

export class AmplinkSession extends DurableObject<CloudflareEnv> {
  private history: ConversationEntry[] = [];
  private readonly analyzeIntent: ReturnType<typeof createWorkersAiIntentAnalyzer>;
  private readonly summarizeDesktopResult: ReturnType<typeof createWorkersAiResultSummarizer>;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.analyzeIntent = createWorkersAiIntentAnalyzer(env.AI);
    this.summarizeDesktopResult = createWorkersAiResultSummarizer(env.AI);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/task-result" && request.method === "POST") {
      return this.handleTaskResult(request);
    }

    if (url.pathname !== "/connect") {
      return json({ error: "Unknown Durable Object route." }, 404);
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const sessionId = url.searchParams.get("session")?.trim();
    const userId =
      url.searchParams.get("user")?.trim() ||
      this.env.AMPLINK_DEFAULT_USER?.trim() ||
      "anonymous";
    const device = url.searchParams.get("device")?.trim() || "mobile";

    if (!sessionId) {
      return json({ error: "session query parameter is required." }, 400);
    }

    if (device !== "mobile") {
      return json({ error: `Unsupported device "${device}".` }, 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const socketMeta: VoiceSocketMeta = {
      sessionId,
      userId,
      device,
      connectedAt: new Date().toISOString(),
    };

    // Hibernation-friendly socket metadata lives in attachments, while tags
    // let us efficiently query active mobile sockets after wake-up.
    server.serializeAttachment(socketMeta);
    this.ctx.acceptWebSocket(server, [
      `session:${sessionId}`,
      `user:${userId}`,
      `device:${device}`,
    ]);

    await updateSessionStatus(this.env.DB, sessionId, "connected");

    this.sendJson(server, {
      type: "session.ready",
      sessionId,
      history: this.history,
      connectedClients: this.ctx.getWebSockets("device:mobile").length,
      at: new Date().toISOString(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const meta = this.getSocketMeta(ws);
    if (!meta) {
      this.sendJson(ws, {
        type: "voice.error",
        message: "Socket metadata is missing.",
      });
      return;
    }

    if (typeof message !== "string") {
      this.sendJson(ws, {
        type: "voice.error",
        sessionId: meta.sessionId,
        message: "Binary audio is not supported yet. Send transcript text for now.",
      });
      return;
    }

    const parsed = parseIncomingVoiceMessage(message);
    if (!parsed) {
      this.sendJson(ws, {
        type: "voice.error",
        sessionId: meta.sessionId,
        message: "Message must be plain text or a JSON envelope.",
      });
      return;
    }

    if (parsed.type === "ping") {
      this.sendJson(ws, {
        type: "pong",
        requestId: parsed.requestId ?? null,
        at: new Date().toISOString(),
      });
      return;
    }

    if (parsed.type === "history.get") {
      this.sendJson(ws, {
        type: "session.history",
        sessionId: meta.sessionId,
        history: this.history,
      });
      return;
    }

    const text = (parsed.transcript || parsed.text || "").trim();
    if (!text) {
      this.sendJson(ws, {
        type: "voice.error",
        sessionId: meta.sessionId,
        message: "voice.input requires text or transcript.",
      });
      return;
    }

    const requestId = parsed.requestId?.trim() || crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const profile = await loadVoiceProfile(this.env, meta.userId);
    await this.saveVoiceProfile(profile);
    await updateSessionStatus(this.env.DB, meta.sessionId, "active", receivedAt);

    console.log("[amplink-session] voice input", {
      sessionId: meta.sessionId,
      userId: meta.userId,
      requestId,
      text,
      ttsMode: profile.ttsMode,
      persona: profile.persona,
      voiceId: profile.voiceId,
      speechRate: profile.speechRate,
    });

    this.sendJson(ws, {
      type: "voice.ack",
      requestId,
      sessionId: meta.sessionId,
      receivedAt,
    });

    try {
      const result = await runVoiceTurn(
        {
          sessionId: meta.sessionId,
          userId: meta.userId,
          text,
          requestId,
          receivedAt,
          locale: parsed.locale,
          metadata: {
            ...(parsed.metadata || {}),
            ttsMode: profile.ttsMode,
            voiceStyleGuide: buildVoiceStyleGuide(profile, "ack", text),
          },
          history: this.history,
        },
        {
          analyzeIntent: this.analyzeIntent,
          synthesizeSpeech: this.createSpeechSynthesizer(profile),
          personalizeOverlay: (overlay, context) =>
            applyVoiceProfileToOverlay(
              profile,
              overlay,
              context.stage,
              context.input.text,
            ),
          dispatch: async (payload) => dispatchToDesktop(this.env, payload),
          log: console,
        },
      );
      this.history = result.history;

      console.log("[amplink-session] voice reply", {
        sessionId: meta.sessionId,
        userId: meta.userId,
        requestId: result.requestId,
        intent: result.intent.intent,
        ttsMode: result.ttsMode,
        persona: profile.persona,
        voiceId: profile.voiceId,
        speechRate: profile.speechRate,
        shouldDispatch: result.intent.shouldDispatch,
        dispatchQueued: result.dispatch.queued,
        dispatchRoute: result.trace.dispatchRoute,
        dispatchTaskId: result.trace.dispatchTaskId,
      });

      this.sendJson(ws, {
        type: "voice.reply",
        requestId: result.requestId,
        sessionId: meta.sessionId,
        text: result.text,
        spokenText: result.spokenText,
        writtenText: result.writtenText,
        presentation: result.presentation,
        intent: result.intent,
        history: result.history,
        tts: result.tts,
        dispatch: result.dispatch,
        trace: result.trace,
        at: result.at,
      });
    } catch (error) {
      await updateSessionStatus(this.env.DB, meta.sessionId, "error");
      console.error("[amplink-session] voice turn failed", {
        sessionId: meta.sessionId,
        userId: meta.userId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendJson(ws, {
        type: "voice.error",
        requestId,
        sessionId: meta.sessionId,
        message: error instanceof Error ? error.message : String(error),
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
    if (meta) {
      await updateSessionStatus(this.env.DB, meta.sessionId, "idle");
    }
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = this.getSocketMeta(ws);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[amplink-session] websocket error", {
      sessionId: meta?.sessionId,
      message,
    });
  }

  private getSocketMeta(ws: WebSocket): VoiceSocketMeta | null {
    try {
      const attachment = ws.deserializeAttachment();
      if (isVoiceSocketMeta(attachment)) {
        return attachment;
      }

      const tags = this.ctx.getTags(ws);
      const sessionId = readTag(tags, "session:");
      const userId = readTag(tags, "user:");
      const device = readTag(tags, "device:") || "mobile";

      if (!sessionId || !userId) {
        return null;
      }

      return {
        sessionId,
        userId,
        device,
        connectedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private sendJson(ws: WebSocket, data: unknown): void {
    ws.send(JSON.stringify(data));
  }

  private createSpeechSynthesizer(profile?: Pick<VoiceProfile, "voiceId" | "speechRate">) {
    return createElevenLabsTtsSynthesizer({
      apiKey: this.env.ELEVENLABS_API_KEY,
      voiceId: profile?.voiceId?.trim() || this.env.ELEVENLABS_VOICE_ID,
      modelId: this.env.ELEVENLABS_MODEL_ID,
      speechRate: profile?.speechRate,
      cache: createKvTtsCache(this.env.AMPLINK_VOICE_PROFILES),
    });
  }

  private async saveVoiceProfile(profile: VoiceProfile): Promise<void> {
    await this.ctx.storage.put(SESSION_VOICE_PROFILE_STORAGE_KEY, profile);
  }

  private async loadVoiceProfile(): Promise<VoiceProfile | null> {
    const stored = await this.ctx.storage.get<VoiceProfile>(
      SESSION_VOICE_PROFILE_STORAGE_KEY,
    );
    return stored && typeof stored === "object" ? stored : null;
  }

  private async handleTaskResult(request: Request): Promise<Response> {
    const payload = safeParse<DesktopTaskResultMessage>(await request.text());
    if (!payload) {
      return json({ error: "Invalid task result payload." }, 400);
    }

    const profile =
      (await this.loadVoiceProfile()) ||
      (await loadVoiceProfile(this.env, this.env.AMPLINK_DEFAULT_USER || "anonymous"));
    const rawSummary = await this.summarizeDesktopResult(
      stringifyDesktopResult(payload.result, payload.error),
      payload.status,
      {
        styleGuide: buildVoiceStyleGuide(
          profile,
          "result",
          stringifyDesktopResult(payload.result, payload.error),
        ),
      },
    );
    const summary = applyVoiceProfileToOverlay(
      profile,
      rawSummary,
      "result",
      stringifyDesktopResult(payload.result, payload.error),
    );
    const tts = shouldSynthesizeVoiceStage(profile.ttsMode, "result")
      ? await safeSynthesizeDesktopResult(
          summary.spokenText,
          this.createSpeechSynthesizer(profile),
        )
      : null;
    const recipients = this.ctx.getWebSockets("device:mobile");

    console.log("[amplink-session] desktop task result", {
      sessionId: payload.sessionId,
      taskId: payload.taskId,
      status: payload.status,
      ttsMode: profile.ttsMode,
      persona: profile.persona,
      voiceId: profile.voiceId,
      speechRate: profile.speechRate,
      recipients: recipients.length,
    });

    for (const socket of recipients) {
      this.sendJson(socket, {
        type: "voice.result",
        sessionId: payload.sessionId,
        taskId: payload.taskId,
        status: payload.status,
        presentation: summary.presentation,
        spokenText: summary.spokenText,
        writtenText: summary.writtenText,
        tts,
        at: payload.completedAt,
      });
    }

    await updateSessionStatus(this.env.DB, payload.sessionId, "active", payload.completedAt);

    return json({
      ok: true,
      delivered: recipients.length,
    }, 202);
  }
}

async function updateSessionStatus(
  db: D1Database,
  sessionId: string,
  status: string,
  lastMessageAt?: string,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE amplink_sessions
       SET status = ?, updated_at = ?, last_message_at = COALESCE(?, last_message_at)
       WHERE id = ?`,
    )
    .bind(status, updatedAt, lastMessageAt ?? null, sessionId)
    .run();
}

function readTag(tags: string[], prefix: string): string | null {
  const tag = tags.find((value) => value.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : null;
}

function isVoiceSocketMeta(value: unknown): value is VoiceSocketMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VoiceSocketMeta).sessionId === "string" &&
    typeof (value as VoiceSocketMeta).userId === "string" &&
    typeof (value as VoiceSocketMeta).device === "string" &&
    typeof (value as VoiceSocketMeta).connectedAt === "string"
  );
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

function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stringifyDesktopResult(result: unknown, fallback?: string): string {
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }

  if (fallback?.trim()) {
    return fallback.trim();
  }

  if (result == null) {
    return "";
  }

  if (typeof result === "object") {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

async function safeSynthesizeDesktopResult(
  text: string,
  synthesizeSpeech: ReturnType<typeof createElevenLabsTtsSynthesizer>,
) {
  try {
    return await synthesizeSpeech(text);
  } catch (error) {
    console.warn("[amplink-session] task-result tts failed", error);
    return null;
  }
}
