import type {
  ConversationEntry,
  DesktopDispatchEnvelope,
  DesktopDispatchResult,
  VoiceIntent,
  VoiceIntentResult,
} from "../src/protocol/dispatch.ts";
import type { Prompt } from "../src/protocol/primitives.ts";

export const INTENT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const HISTORY_LIMIT = 10;
export type VoiceTtsMode = "both" | "ack" | "result" | "off";
export type VoiceTtsStage = "ack" | "result";

const DEFAULT_VOICE_TTS_MODE: VoiceTtsMode = "both";

export interface VoiceSocketMeta {
  sessionId: string;
  userId: string;
  device: string;
  connectedAt: string;
}

export interface VoiceInputMessage {
  type: "voice.input";
  requestId?: string;
  text?: string;
  transcript?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface PingMessage {
  type: "ping";
  requestId?: string;
}

export interface HistoryMessage {
  type: "history.get";
  requestId?: string;
}

export type IncomingClientMessage = VoiceInputMessage | PingMessage | HistoryMessage;

export interface TtsPayload {
  provider: "elevenlabs";
  voiceId: string;
  modelId: string;
  contentType: string;
  audioBase64: string;
}

export type VoicePresentation = "overlay";

export interface VoiceOverlayContent {
  presentation: VoicePresentation;
  spokenText: string;
  writtenText: string;
}

export interface VoiceTurnInput {
  sessionId: string;
  userId: string;
  text: string;
  requestId?: string;
  receivedAt?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  history: ConversationEntry[];
}

export interface VoiceTurnResult {
  requestId: string;
  text: string;
  spokenText: string;
  writtenText: string;
  presentation: VoicePresentation;
  ttsMode: VoiceTtsMode;
  intent: VoiceIntentResult;
  prompt: Prompt;
  tts: TtsPayload | null;
  dispatch: DesktopDispatchResult;
  trace: VoiceTrace;
  history: ConversationEntry[];
  at: string;
}

export interface VoiceTrace {
  path: "cloudflare-only" | "cloudflare+desktop";
  dispatchAttempted: boolean;
  dispatchQueued: boolean;
  dispatchRoute: "none" | "control-websocket" | "http-endpoint" | "unknown";
  dispatchTaskId?: string;
  dispatchError?: string;
}

export interface VoiceTurnServices {
  analyzeIntent: (
    text: string,
    history: ConversationEntry[],
    options?: { styleGuide?: string },
  ) => Promise<VoiceIntentResult>;
  synthesizeSpeech: (text: string) => Promise<TtsPayload | null>;
  personalizeOverlay?: (
    overlay: VoiceOverlayContent,
    context: {
      stage: "ack";
      input: VoiceTurnInput;
      intent: VoiceIntentResult;
      replyText: string;
    },
  ) => Promise<VoiceOverlayContent> | VoiceOverlayContent;
  dispatch?: (payload: DesktopDispatchEnvelope) => Promise<DesktopDispatchResult>;
  now?: () => string;
  createRequestId?: () => string;
  log?: Pick<Console, "warn">;
}

type WorkersAiResponse = {
  response?: string;
  result?: {
    response?: string;
  };
};

interface ElevenLabsConfig {
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  speechRate?: number;
  fetchImpl?: typeof fetch;
  cache?: VoiceTtsCache;
}

export interface VoiceTtsCache {
  get(key: string): Promise<TtsPayload | null>;
  put(key: string, payload: TtsPayload): Promise<void>;
}

export function parseIncomingVoiceMessage(message: string): IncomingClientMessage | null {
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

export function appendConversationEntry(
  history: ConversationEntry[],
  entry: ConversationEntry,
  limit = HISTORY_LIMIT,
): ConversationEntry[] {
  const next = [...history, entry];
  if (next.length <= limit) {
    return next;
  }

  return next.slice(next.length - limit);
}

export function buildPrompt(
  sessionId: string,
  text: string,
  intent: VoiceIntentResult,
  locale?: string,
  metadata?: Record<string, unknown>,
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
      ...(locale ? { locale } : {}),
      ...(metadata ? { voiceMetadata: metadata } : {}),
    },
  };
}

export async function runVoiceTurn(
  input: VoiceTurnInput,
  services: VoiceTurnServices,
): Promise<VoiceTurnResult> {
  const now = services.now ?? (() => new Date().toISOString());
  const requestId = input.requestId?.trim() || services.createRequestId?.() || crypto.randomUUID();
  const receivedAt = input.receivedAt ?? now();
  const ttsMode = resolveVoiceTtsMode(input.metadata);

  let history = appendConversationEntry(input.history, {
    role: "user",
    text: input.text,
    at: receivedAt,
  });

  const intent = await services.analyzeIntent(
    input.text,
    history,
    {
      styleGuide:
        typeof input.metadata?.voiceStyleGuide === "string"
          ? input.metadata.voiceStyleGuide
          : undefined,
    },
  );
  const fallback = buildFallbackIntent(input.text);
  const replyText = intent.reply.trim() || fallback.reply;
  const baseOverlay = createVoiceOverlay(replyText);
  const overlay = services.personalizeOverlay
    ? await services.personalizeOverlay(baseOverlay, {
        stage: "ack",
        input,
        intent,
        replyText,
      })
    : baseOverlay;
  const repliedAt = now();

  if (intent.intent === "intake" && intent.shouldDispatch) {
    services.log?.warn?.("[voice-core] intake intent requested desktop dispatch", {
      sessionId: input.sessionId,
      requestId,
      confidence: intent.confidence,
      dispatchPrompt: intent.dispatchPrompt,
    });
  }

  history = appendConversationEntry(history, {
    role: "assistant",
    text: overlay.writtenText,
    at: repliedAt,
  });

  const targetSessionId = resolveDesktopSessionId(input.metadata);

  const prompt = buildPrompt(
    targetSessionId ?? input.sessionId,
    input.text,
    intent,
    input.locale,
    input.metadata,
  );

  const [tts, dispatch] = await Promise.all([
    shouldSynthesizeVoiceStage(ttsMode, "ack")
      ? safeSynthesizeSpeech(overlay.spokenText, services)
      : Promise.resolve<TtsPayload | null>(null),
    intent.shouldDispatch && services.dispatch
      ? services.dispatch({
          source: "cloudflare-voice",
          sessionId: input.sessionId,
          userId: input.userId,
          prompt,
          targetSessionId,
          target: targetSessionId ? { sessionId: targetSessionId } : undefined,
          quickReply: replyText,
          intent,
          history: [...history],
          requestedAt: receivedAt,
        })
      : Promise.resolve<DesktopDispatchResult>({
          queued: false,
          skipped: true,
          route: "none",
          error: intent.shouldDispatch
            ? "No desktop dispatch handler is configured yet."
            : "Intent handled locally without desktop dispatch.",
        }),
  ]);

  const trace = buildVoiceTrace(intent, dispatch);

  return {
    requestId,
    text: overlay.writtenText,
    spokenText: overlay.spokenText,
    writtenText: overlay.writtenText,
    presentation: overlay.presentation,
    ttsMode,
    intent,
    prompt,
    tts,
    dispatch,
    trace,
    history,
    at: repliedAt,
  };
}

export function resolveVoiceTtsMode(
  metadata?: Record<string, unknown>,
  fallback: VoiceTtsMode = DEFAULT_VOICE_TTS_MODE,
): VoiceTtsMode {
  const candidate =
    metadata?.ttsMode ??
    metadata?.voiceTtsMode ??
    metadata?.voiceReplyAudioMode ??
    metadata?.audioMode;

  const normalized = normalizeVoiceTtsMode(candidate);
  return normalized ?? fallback;
}

export function shouldSynthesizeVoiceStage(
  mode: VoiceTtsMode,
  stage: VoiceTtsStage,
): boolean {
  if (mode === "off") {
    return false;
  }

  if (mode === "both") {
    return true;
  }

  return mode === stage;
}

export interface VoiceResultSummary extends VoiceOverlayContent {}

export function buildVoiceTrace(
  intent: VoiceIntentResult,
  dispatch: DesktopDispatchResult,
): VoiceTrace {
  const dispatchRoute = dispatch.route ?? "unknown";
  return {
    path: dispatch.queued ? "cloudflare+desktop" : "cloudflare-only",
    dispatchAttempted: intent.shouldDispatch,
    dispatchQueued: dispatch.queued,
    dispatchRoute,
    dispatchTaskId: dispatch.taskId,
    dispatchError: dispatch.error,
  };
}

function resolveDesktopSessionId(
  metadata?: Record<string, unknown>,
): string | undefined {
  const candidates = [
    metadata?.desktopSessionId,
    metadata?.amplinkSessionId,
    metadata?.targetSessionId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

export function createWorkersAiIntentAnalyzer(
  ai: Pick<Ai, "run">,
  model: keyof AiModels & string = INTENT_MODEL as keyof AiModels & string,
): VoiceTurnServices["analyzeIntent"] {
  return async (text, history, options) => {
    const fallback = buildFallbackIntent(text);
    const conversationContext = history
      .slice(-4)
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join("\n");

    const prompt = [
      "You are the low-latency intent parser for Amplink voice sessions.",
      "Return strict JSON only with keys intent, reply, shouldDispatch, dispatchPrompt, confidence.",
      "intent must be one of: command, question, status, intake, dictation.",
      "reply must be a short spoken receipt and stay under 120 characters.",
      "For anything except intake, the desktop agent will do the real work.",
      "Do not answer the user's actual question in reply.",
      "For command, question, status, and dictation, set shouldDispatch=true.",
      "Only set shouldDispatch=false for clear intake chatter like hello or thanks.",
      options?.styleGuide ? `Reply style guide: ${options.styleGuide}` : "",
      "Do not wrap the JSON in markdown.",
      "",
      `Recent conversation:\n${conversationContext || "No prior turns."}`,
      "",
      `Latest user utterance: ${text}`,
    ].join("\n");

    try {
      const result = (await ai.run(model, {
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
    } catch {
      return fallback;
    }
  };
}

export function createElevenLabsTtsSynthesizer(
  config: ElevenLabsConfig,
): VoiceTurnServices["synthesizeSpeech"] {
  const fetchImpl = config.fetchImpl ?? fetch;
  const ttsCache = config.cache;

  return async (text) => {
    const apiKey = config.apiKey?.trim();
    const voiceId = config.voiceId?.trim();
    if (!apiKey || !voiceId) {
      return null;
    }

    const normalizedText = compactOverlayText(text);
    if (!normalizedText) {
      return null;
    }

    const modelId = config.modelId?.trim() || "eleven_multilingual_v2";
    const speechRate = normalizeSpeechRate(config.speechRate);
    const cacheKey = ttsCache
      ? await buildVoiceTtsCacheKey(voiceId, modelId, speechRate, normalizedText)
      : null;

    if (cacheKey && ttsCache) {
      const cached = await ttsCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": apiKey,
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: normalizedText,
          model_id: modelId,
          voice_settings: {
            speed: speechRate,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS failed with ${response.status}.`);
    }

    const audio = await response.arrayBuffer();
    const payload: TtsPayload = {
      provider: "elevenlabs",
      voiceId,
      modelId,
      contentType: response.headers.get("content-type") || "audio/mpeg",
      audioBase64: toBase64(audio),
    };

    if (cacheKey && ttsCache) {
      await ttsCache.put(cacheKey, payload);
    }

    return payload;
  };
}

export function createKvTtsCache(
  namespace?: KVNamespace,
  ttlSeconds = 60 * 60 * 24 * 7,
): VoiceTtsCache | undefined {
  if (!namespace) {
    return undefined;
  }

  return {
    async get(key) {
      const cached = await namespace.get(key, "json");
      return isTtsPayload(cached) ? cached : null;
    },
    async put(key, payload) {
      await namespace.put(key, JSON.stringify(payload), {
        expirationTtl: ttlSeconds,
      });
    },
  };
}

export function createWorkersAiResultSummarizer(
  ai: Pick<Ai, "run">,
  model: keyof AiModels & string = INTENT_MODEL as keyof AiModels & string,
): (
  resultText: string,
  status: "done" | "error",
  options?: { styleGuide?: string },
) => Promise<VoiceResultSummary> {
  return async (resultText, status, options) => {
    const fallback = buildFallbackDesktopResultSummary(resultText, status);
    const normalizedResult = resultText.trim();
    if (!normalizedResult) {
      return fallback;
    }

    const prompt = [
      "You produce short spoken summaries for Amplink desktop task results.",
      "Return strict JSON only with keys spokenText and writtenText.",
      "spokenText should sound natural when spoken and stay under 160 characters.",
      "writtenText should be a short overlay label and stay under 120 characters.",
      "Do not repeat the full task result verbatim.",
      options?.styleGuide ? `Style guide: ${options.styleGuide}` : "",
      "Do not use markdown.",
      "",
      `Task status: ${status}`,
      "",
      `Desktop result:\n${normalizedResult}`,
    ].join("\n");

    try {
      const result = (await ai.run(model, {
        messages: [
          {
            role: "system",
            content:
              "You summarize desktop coding-agent results into one short spoken update and one short overlay label. Always return strict JSON only.",
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

      const parsed = safeParse<Partial<VoiceResultSummary>>(extractJsonObject(raw));
      if (!parsed) {
        return fallback;
      }

      return {
        presentation: "overlay",
        spokenText: normalizeOverlayText(parsed.spokenText, fallback.spokenText),
        writtenText: normalizeOverlayText(parsed.writtenText, fallback.writtenText),
      };
    } catch {
      return fallback;
    }
  };
}

export function buildFallbackDesktopResultSummary(
  resultText: string,
  status: "done" | "error",
): VoiceResultSummary {
  const compact = compactOverlayText(resultText);
  const clipped = clipOverlayText(compact, 110);

  if (status === "error") {
    return {
      presentation: "overlay",
      spokenText: clipped
        ? `The desktop task hit an issue. ${clipped}`
        : "The desktop task hit an issue. Check the session for details.",
      writtenText: clipped
        ? `Desktop issue: ${clipped}`
        : "Desktop task hit an issue.",
    };
  }

  return {
    presentation: "overlay",
    spokenText: clipped
      ? `Amplink finished the desktop task. ${clipped}`
      : "Amplink finished the desktop task.",
    writtenText: clipped
      ? `Desktop result: ${clipped}`
      : "Desktop task finished.",
  };
}

export function buildFallbackIntent(text: string): VoiceIntentResult {
  const normalized = text.toLowerCase();
  const isIntake =
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

  if (isIntake) {
    return {
      intent: "intake",
      reply: "I'm here and ready. Tell me what you want Amplink to handle.",
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

function sanitizeIntentResult(
  candidate: Partial<VoiceIntentResult>,
  fallback: VoiceIntentResult,
): VoiceIntentResult {
  const intent = normalizeVoiceIntent(candidate.intent) ?? fallback.intent;
  const reply =
    intent === "intake"
      ? candidate.reply?.trim() || fallback.reply
      : buildDispatchReceipt(intent);
  const dispatchPrompt = candidate.dispatchPrompt?.trim() || fallback.dispatchPrompt;
  const confidence = clampConfidence(candidate.confidence);
  const shouldDispatch = intent === "intake" ? false : true;

  return {
    intent,
    reply,
    shouldDispatch,
    dispatchPrompt,
    confidence,
  };
}

function buildDispatchReceipt(intent: VoiceIntent): string {
  switch (intent) {
    case "status":
      return "Checking that on your desktop session now.";
    case "question":
      return "I heard your question. I'm passing it to the desktop agent now.";
    case "command":
      return "Okay. I'm sending that to your desktop agent.";
    case "dictation":
      return "Captured. I'm forwarding that to the desktop agent.";
    case "intake":
    default:
      return "I'm here and ready. Tell me what you want Amplink to handle.";
  }
}

function createVoiceOverlay(text: string): VoiceOverlayContent {
  const normalized = normalizeOverlayText(text, "Amplink is working on that now.");
  return {
    presentation: "overlay",
    spokenText: normalized,
    writtenText: normalized,
  };
}

async function safeSynthesizeSpeech(
  text: string,
  services: VoiceTurnServices,
): Promise<TtsPayload | null> {
  try {
    return await services.synthesizeSpeech(text);
  } catch (error) {
    services.log?.warn?.("[voice-core] tts synthesis failed", error);
    return null;
  }
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
  const trimmed = value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return trimmed;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
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
    value === "intake" ||
    value === "dictation"
  );
}

function normalizeVoiceIntent(value: unknown): VoiceIntentResult["intent"] | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "smalltalk") {
    return "intake";
  }

  return isVoiceIntent(normalized) ? normalized : null;
}

function normalizeVoiceTtsMode(value: unknown): VoiceTtsMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (
    normalized === "both" ||
    normalized === "all"
  ) {
    return "both";
  }

  if (
    normalized === "ack" ||
    normalized === "receipt" ||
    normalized === "ack-only" ||
    normalized === "receipt-only"
  ) {
    return "ack";
  }

  if (
    normalized === "result" ||
    normalized === "completion" ||
    normalized === "end" ||
    normalized === "result-only" ||
    normalized === "completion-only" ||
    normalized === "end-only"
  ) {
    return "result";
  }

  if (
    normalized === "off" ||
    normalized === "none" ||
    normalized === "mute" ||
    normalized === "disabled"
  ) {
    return "off";
  }

  return null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeOverlayText(value: string | undefined, fallback: string): string {
  const compact = compactOverlayText(value || "");
  if (!compact) {
    return fallback;
  }

  return clipOverlayText(compact, 160) || fallback;
}

function compactOverlayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipOverlayText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
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

async function buildVoiceTtsCacheKey(
  voiceId: string,
  modelId: string,
  speechRate: number,
  text: string,
): Promise<string> {
  const data = new TextEncoder().encode(
    `elevenlabs:${voiceId}:${modelId}:${speechRate.toFixed(2)}:${text}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `voice-tts:${voiceId}:${modelId}:${speechRate.toFixed(2)}:${hex}`;
}

function normalizeSpeechRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1.2, Math.max(0.7, Number(value.toFixed(2))));
}

function isTtsPayload(value: unknown): value is TtsPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as TtsPayload).provider === "elevenlabs" &&
    typeof (value as TtsPayload).voiceId === "string" &&
    typeof (value as TtsPayload).modelId === "string" &&
    typeof (value as TtsPayload).contentType === "string" &&
    typeof (value as TtsPayload).audioBase64 === "string"
  );
}
