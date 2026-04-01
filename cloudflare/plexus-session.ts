import { DurableObject } from "cloudflare:workers";

import { dispatchToDesktop, type ConversationEntry, type VoiceIntentResult } from "./control.ts";
import type { Prompt } from "../src/protocol/primitives.ts";

const INTENT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const HISTORY_LIMIT = 10;

interface VoiceInputMessage {
  type: "voice.input";
  requestId?: string;
  text?: string;
  transcript?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

interface PingMessage {
  type: "ping";
  requestId?: string;
}

interface HistoryMessage {
  type: "history.get";
  requestId?: string;
}

type IncomingClientMessage = VoiceInputMessage | PingMessage | HistoryMessage;

interface SocketMeta {
  sessionId: string;
  userId: string;
  device: string;
}

interface TtsPayload {
  provider: "elevenlabs";
  voiceId: string;
  modelId: string;
  contentType: string;
  audioBase64: string;
}

type WorkersAiResponse = {
  response?: string;
  result?: {
    response?: string;
  };
};

export class PlexusSession extends DurableObject<CloudflareEnv> {
  private history: ConversationEntry[] = [];

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/connect") {
      return json({ error: "Unknown Durable Object route." }, 404);
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade request." }, 426);
    }

    const sessionId = url.searchParams.get("session")?.trim();
    const userId =
      url.searchParams.get("user")?.trim() ||
      this.env.PLEXUS_DEFAULT_USER?.trim() ||
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
      connectedClients: this.ctx.getWebSockets().length,
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

    const parsed = this.parseMessage(message);
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

    this.pushHistory({ role: "user", text, at: receivedAt });
    await updateSessionStatus(this.env.DB, meta.sessionId, "active", receivedAt);

    this.sendJson(ws, {
      type: "voice.ack",
      requestId,
      sessionId: meta.sessionId,
      receivedAt,
    });

    try {
      const intent = await this.analyzeIntent(text);
      const quickReply = intent.reply.trim() || buildFallbackIntent(text).reply;
      this.pushHistory({ role: "assistant", text: quickReply, at: new Date().toISOString() });

      const prompt = this.buildPrompt(meta.sessionId, text, intent);
      const [tts, dispatch] = await Promise.all([
        this.synthesizeSpeech(quickReply),
        intent.shouldDispatch
          ? dispatchToDesktop(this.env, {
              source: "cloudflare-voice",
              sessionId: meta.sessionId,
              userId: meta.userId,
              prompt,
              quickReply,
              intent,
              history: [...this.history],
              requestedAt: receivedAt,
            })
          : Promise.resolve({
              queued: false,
              skipped: true,
              error: "Intent handled locally without desktop dispatch.",
            }),
      ]);

      this.sendJson(ws, {
        type: "voice.reply",
        requestId,
        sessionId: meta.sessionId,
        text: quickReply,
        intent,
        history: this.history,
        tts,
        dispatch,
        at: new Date().toISOString(),
      });
    } catch (error) {
      await updateSessionStatus(this.env.DB, meta.sessionId, "error");
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
    ws.close(code, reason);
    if (meta) {
      await updateSessionStatus(this.env.DB, meta.sessionId, "idle");
    }
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = this.getSocketMeta(ws);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[plexus-session] websocket error", {
      sessionId: meta?.sessionId,
      message,
    });
  }

  private async analyzeIntent(text: string): Promise<VoiceIntentResult> {
    const fallback = buildFallbackIntent(text);
    const conversationContext = this.history
      .slice(-4)
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join("\n");

    const prompt = [
      "You are the low-latency intent parser for Plexus voice sessions.",
      "Return strict JSON only with keys intent, reply, shouldDispatch, dispatchPrompt, confidence.",
      "intent must be one of: command, question, status, smalltalk, dictation.",
      "reply should sound natural when spoken and stay under 160 characters.",
      "Set shouldDispatch=true for anything that needs the desktop agent.",
      "Do not wrap the JSON in markdown.",
      "",
      `Recent conversation:\n${conversationContext || "No prior turns."}`,
      "",
      `Latest user utterance: ${text}`,
    ].join("\n");

    try {
      const result = (await this.env.AI.run(INTENT_MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You classify short voice requests for a desktop coding agent. Always return strict JSON and nothing else.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 220,
        temperature: 0.2,
      })) as WorkersAiResponse | string;

      const raw = extractAiText(result);
      if (!raw) {
        return fallback;
      }

      const parsed = safeParse<Partial<VoiceIntentResult>>(extractJsonObject(raw));
      if (!parsed) {
        return fallback;
      }

      return sanitizeIntentResult(parsed, fallback);
    } catch (error) {
      console.warn("[plexus-session] Workers AI fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  private buildPrompt(
    sessionId: string,
    text: string,
    intent: VoiceIntentResult,
  ): Prompt {
    return {
      sessionId,
      text: intent.dispatchPrompt || text,
      providerOptions: {
        source: "cloudflare-voice",
        channel: "voice",
        intent: intent.intent,
        confidence: intent.confidence,
        quickReply: intent.reply,
      },
    };
  }

  private async synthesizeSpeech(text: string): Promise<TtsPayload | null> {
    const apiKey = this.env.ELEVENLABS_API_KEY?.trim();
    const voiceId = this.env.ELEVENLABS_VOICE_ID?.trim();
    if (!apiKey || !voiceId) {
      return null;
    }

    const modelId = this.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": apiKey,
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS failed with ${response.status}.`);
    }

    const audio = await response.arrayBuffer();
    return {
      provider: "elevenlabs",
      voiceId,
      modelId,
      contentType: response.headers.get("content-type") || "audio/mpeg",
      audioBase64: toBase64(audio),
    };
  }

  private parseMessage(message: string): IncomingClientMessage | null {
    const trimmed = message.trim();
    if (!trimmed) {
      return null;
    }

    if (!trimmed.startsWith("{")) {
      return {
        type: "voice.input",
        text: trimmed,
      };
    }

    const parsed = safeParse<Record<string, unknown>>(trimmed);
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }

    if (parsed.type === "ping") {
      return {
        type: "ping",
        requestId: asOptionalString(parsed.requestId),
      };
    }

    if (parsed.type === "history.get") {
      return {
        type: "history.get",
        requestId: asOptionalString(parsed.requestId),
      };
    }

    if (parsed.type === "voice.input") {
      return {
        type: "voice.input",
        requestId: asOptionalString(parsed.requestId),
        text: asOptionalString(parsed.text),
        transcript: asOptionalString(parsed.transcript),
        locale: asOptionalString(parsed.locale),
        metadata: isRecord(parsed.metadata) ? parsed.metadata : undefined,
      };
    }

    return null;
  }

  private getSocketMeta(ws: WebSocket): SocketMeta | null {
    try {
      const tags = this.ctx.getTags(ws);
      const sessionId = readTag(tags, "session:");
      const userId = readTag(tags, "user:");
      const device = readTag(tags, "device:") || "mobile";

      if (!sessionId || !userId) {
        return null;
      }

      return { sessionId, userId, device };
    } catch {
      return null;
    }
  }

  private pushHistory(entry: ConversationEntry): void {
    this.history.push(entry);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
  }

  private sendJson(ws: WebSocket, data: unknown): void {
    ws.send(JSON.stringify(data));
  }
}

function sanitizeIntentResult(
  candidate: Partial<VoiceIntentResult>,
  fallback: VoiceIntentResult,
): VoiceIntentResult {
  const intent = isVoiceIntent(candidate.intent) ? candidate.intent : fallback.intent;
  const reply = candidate.reply?.trim() || fallback.reply;
  const dispatchPrompt = candidate.dispatchPrompt?.trim() || fallback.dispatchPrompt;
  const confidence = clampConfidence(candidate.confidence);
  const shouldDispatch =
    typeof candidate.shouldDispatch === "boolean"
      ? candidate.shouldDispatch
      : fallback.shouldDispatch;

  return {
    intent,
    reply,
    shouldDispatch,
    dispatchPrompt,
    confidence,
  };
}

function buildFallbackIntent(text: string): VoiceIntentResult {
  const normalized = text.toLowerCase();
  const isSmalltalk =
    /^(hi|hello|hey|thanks|thank you|yo)\b/.test(normalized) ||
    normalized === "thanks" ||
    normalized === "hello";
  const isStatus =
    normalized.includes("status") ||
    normalized.includes("what's going on") ||
    normalized.includes("whats going on") ||
    normalized.includes("are we done");
  const isQuestion =
    text.trim().endsWith("?") ||
    /^(what|why|how|when|where|who|can you|could you|would you)\b/.test(normalized);
  const isCommand =
    /^(open|run|search|find|fix|edit|summarize|show|check|dispatch|start)\b/.test(
      normalized,
    );

  if (isSmalltalk) {
    return {
      intent: "smalltalk",
      reply: "I'm here. Tell me what you want the desktop agent to do.",
      shouldDispatch: false,
      dispatchPrompt: text,
      confidence: 0.92,
    };
  }

  if (isStatus) {
    return {
      intent: "status",
      reply: "Checking that on your desktop session now.",
      shouldDispatch: true,
      dispatchPrompt: text,
      confidence: 0.78,
    };
  }

  if (isQuestion) {
    return {
      intent: "question",
      reply: "I heard your question. I'm passing it to the desktop agent now.",
      shouldDispatch: true,
      dispatchPrompt: text,
      confidence: 0.72,
    };
  }

  if (isCommand) {
    return {
      intent: "command",
      reply: "Okay. I'm sending that to your desktop agent.",
      shouldDispatch: true,
      dispatchPrompt: text,
      confidence: 0.81,
    };
  }

  return {
    intent: "dictation",
    reply: "Captured. I'm forwarding that to the desktop agent.",
    shouldDispatch: true,
    dispatchPrompt: text,
    confidence: 0.61,
  };
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
      `UPDATE plexus_sessions
       SET status = ?, updated_at = ?, last_message_at = COALESCE(?, last_message_at)
       WHERE id = ?`,
    )
    .bind(status, updatedAt, lastMessageAt ?? null, sessionId)
    .run();
}

function extractAiText(result: WorkersAiResponse | string): string {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result.response === "string") {
    return result.response;
  }

  if (typeof result.result?.response === "string") {
    return result.result.response;
  }

  return "";
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return trimmed;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function readTag(tags: string[], prefix: string): string | null {
  const tag = tags.find((value) => value.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isVoiceIntent(value: unknown): value is VoiceIntentResult["intent"] {
  return (
    value === "command" ||
    value === "question" ||
    value === "status" ||
    value === "smalltalk" ||
    value === "dictation"
  );
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
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
