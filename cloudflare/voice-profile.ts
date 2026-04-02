import type { VoiceOverlayContent, VoiceTtsMode } from "./voice-core.ts";

export type VoicePersona = "operator" | "warm" | "dry" | "roast";
export type VoiceRoastFrequency = "off" | "rare" | "sometimes";
export type VoiceStage = "ack" | "result";

export interface VoiceProfile {
  userId: string;
  voiceId: string;
  speechRate: number;
  ttsMode: VoiceTtsMode;
  persona: VoicePersona;
  roastFrequency: VoiceRoastFrequency;
  customStyle: string;
  updatedAt: string;
}

export interface VoiceProfileInput {
  voiceId?: string;
  speechRate?: number | string;
  ttsMode?: string;
  persona?: string;
  roastFrequency?: string;
  customStyle?: string;
  updatedAt?: string;
}

export interface StoredVoiceProfile {
  voiceId?: string;
  speechRate?: number;
  ttsMode?: string;
  persona?: string;
  roastFrequency?: string;
  customStyle?: string;
  updatedAt?: string;
}

const DEFAULT_PERSONA: VoicePersona = "operator";
const DEFAULT_ROAST_FREQUENCY: VoiceRoastFrequency = "rare";
const DEFAULT_TTS_MODE: VoiceTtsMode = "both";
export const DEFAULT_SPEECH_RATE = 1;
export const MIN_SPEECH_RATE = 0.7;
export const MAX_SPEECH_RATE = 1.2;

export async function loadVoiceProfile(
  env: Pick<CloudflareEnv, "AMPLINK_VOICE_PROFILES" | "ELEVENLABS_VOICE_ID">,
  userId: string,
): Promise<VoiceProfile> {
  const fallback = buildDefaultVoiceProfile(env, userId);
  const stored = await env.AMPLINK_VOICE_PROFILES?.get(voiceProfileKey(userId), "json");
  if (!isStoredVoiceProfile(stored)) {
    return fallback;
  }

  return mergeVoiceProfile(fallback, stored);
}

export async function saveVoiceProfile(
  env: Pick<CloudflareEnv, "AMPLINK_VOICE_PROFILES" | "ELEVENLABS_VOICE_ID">,
  userId: string,
  input: VoiceProfileInput,
): Promise<VoiceProfile> {
  const existing = await loadVoiceProfile(env, userId);
  const profile = mergeVoiceProfile(existing, input);
  if (env.AMPLINK_VOICE_PROFILES) {
    await env.AMPLINK_VOICE_PROFILES.put(
      voiceProfileKey(userId),
      JSON.stringify(profile),
    );
  }

  return profile;
}

export function buildDefaultVoiceProfile(
  env: Pick<CloudflareEnv, "ELEVENLABS_VOICE_ID">,
  userId: string,
): VoiceProfile {
  return {
    userId,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || "",
    speechRate: DEFAULT_SPEECH_RATE,
    ttsMode: DEFAULT_TTS_MODE,
    persona: DEFAULT_PERSONA,
    roastFrequency: DEFAULT_ROAST_FREQUENCY,
    customStyle: "",
    updatedAt: new Date().toISOString(),
  };
}

export function mergeVoiceProfile(
  base: VoiceProfile,
  input: StoredVoiceProfile | VoiceProfileInput,
): VoiceProfile {
  return {
    ...base,
    voiceId:
      typeof input.voiceId === "string" && input.voiceId.trim()
        ? input.voiceId.trim()
        : base.voiceId,
    speechRate: normalizeSpeechRate(input.speechRate) ?? base.speechRate,
    ttsMode: normalizeVoiceTtsMode(input.ttsMode) ?? base.ttsMode,
    persona: normalizeVoicePersona(input.persona) ?? base.persona,
    roastFrequency:
      normalizeRoastFrequency(input.roastFrequency) ?? base.roastFrequency,
    customStyle:
      typeof input.customStyle === "string" ? input.customStyle.trim() : base.customStyle,
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt.trim()
        ? input.updatedAt
        : new Date().toISOString(),
  };
}

export function buildVoiceStyleGuide(
  profile: VoiceProfile,
  stage: VoiceStage,
  seedText: string,
): string {
  const baseRules = [
    "Keep it concise, spoken, and natural.",
    "Do not narrate internal reasoning.",
    "Never be hostile, profane, or demeaning.",
    stage === "ack"
      ? "This is a quick receipt while background work may continue."
      : "This is a short completion summary, not a transcript.",
  ];

  const personaRules =
    profile.persona === "warm"
      ? [
          "Tone: warm, steady, lightly reassuring.",
          "Sound helpful, not chatty.",
        ]
      : profile.persona === "dry"
        ? [
            "Tone: concise, dry, slightly wry.",
            "Use restrained wit only when it fits naturally.",
          ]
        : profile.persona === "roast"
          ? shouldRoast(profile, seedText)
            ? [
                "Tone: playful and mildly teasing.",
                "Add at most one short roast clause.",
                "Keep the roast affectionate and lightweight.",
              ]
            : [
                "Tone: concise and lightly dry.",
                "Skip the roast this time.",
              ]
          : [
              "Tone: crisp operator voice.",
              "Be calm, efficient, and direct.",
            ];

  const customRules = profile.customStyle
    ? [`Additional style request: ${profile.customStyle}`]
    : [];

  return [...baseRules, ...personaRules, ...customRules].join(" ");
}

export function buildVoicePreviewOverlay(
  profile: VoiceProfile,
  stage: VoiceStage,
): VoiceOverlayContent {
  const base =
    stage === "ack"
      ? "Got it. I’m sending that to Amplink now."
      : "Amplink finished the task and the result is ready.";

  const personaText =
    profile.persona === "warm"
      ? stage === "ack"
        ? "Got it. I’m handing that to Amplink now, and I’ll keep you posted."
        : "Amplink wrapped it up. The result is ready for you."
      : profile.persona === "dry"
        ? stage === "ack"
          ? "Copy. Amplink has the job now."
          : "Done. Amplink finished without setting anything on fire."
        : profile.persona === "roast"
          ? stage === "ack"
            ? "Fine. I’m sending that to Amplink now. Bold request, honestly."
            : "Amplink finished the task. Somehow the code survived."
          : base;

  const text = clipOverlayText(
    [personaText, profile.customStyle ? `Style note: ${profile.customStyle}` : ""]
      .filter(Boolean)
      .join(" "),
    160,
  );

  return {
    presentation: "overlay",
    spokenText: text,
    writtenText: text,
  };
}

export function applyVoiceProfileToOverlay(
  profile: VoiceProfile,
  overlay: VoiceOverlayContent,
  stage: VoiceStage,
  seedText: string,
): VoiceOverlayContent {
  const roastSeed = `${profile.userId}:${stage}:${seedText}`;
  const roastEnabled = profile.persona === "roast" && shouldRoast(profile, roastSeed);
  const roastClause = roastEnabled ? pickRoastLine(stage, roastSeed) : "";

  let spokenText = overlay.spokenText;
  let writtenText = overlay.writtenText;

  if (profile.persona === "warm") {
    spokenText = stage === "ack"
      ? ensureSuffix(spokenText, " I'll keep you posted.")
      : ensurePrefix(spokenText, "All right. ");
    writtenText = spokenText;
  } else if (profile.persona === "dry") {
    spokenText = stage === "ack"
      ? ensurePrefix(spokenText, "Copy. ")
      : ensurePrefix(spokenText, "Done. ");
    writtenText = spokenText;
  } else if (profile.persona === "roast") {
    spokenText = stage === "ack"
      ? ensurePrefix(spokenText, "Fine. ")
      : ensurePrefix(spokenText, "Done. ");
    if (roastClause) {
      spokenText = ensureSuffix(spokenText, ` ${roastClause}`);
    }
    writtenText = spokenText;
  }

  return {
    presentation: overlay.presentation,
    spokenText: clipOverlayText(spokenText, 160),
    writtenText: clipOverlayText(writtenText, 160),
  };
}

export function voiceProfileKey(userId: string): string {
  return `voice-profile:user:${userId}`;
}

export function isVoiceProfileInput(value: unknown): value is VoiceProfileInput {
  return typeof value === "object" && value !== null;
}

export function voicePersonaOptions(): VoicePersona[] {
  return ["operator", "warm", "dry", "roast"];
}

export function voiceTtsModeOptions(): VoiceTtsMode[] {
  return ["both", "ack", "result", "off"];
}

export function voiceRoastFrequencyOptions(): VoiceRoastFrequency[] {
  return ["off", "rare", "sometimes"];
}

export function formatSpeechRateLabel(value: number): string {
  const normalized = normalizeSpeechRate(value) ?? DEFAULT_SPEECH_RATE;
  if (Math.abs(normalized - DEFAULT_SPEECH_RATE) < 0.01) {
    return "Normal";
  }

  if (normalized < DEFAULT_SPEECH_RATE) {
    return `${normalized.toFixed(2)}x slower`;
  }

  return `${normalized.toFixed(2)}x faster`;
}

function shouldRoast(profile: VoiceProfile, seedText: string): boolean {
  if (profile.roastFrequency === "off") {
    return false;
  }

  const hash = stableHash(`${profile.userId}:${seedText}`);
  if (profile.roastFrequency === "rare") {
    return hash % 5 === 0;
  }

  return hash % 2 === 0;
}

function normalizeVoicePersona(value: unknown): VoicePersona | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "operator" ||
    normalized === "warm" ||
    normalized === "dry" ||
    normalized === "roast"
    ? normalized
    : null;
}

function normalizeRoastFrequency(value: unknown): VoiceRoastFrequency | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "off" ||
    normalized === "rare" ||
    normalized === "sometimes"
    ? normalized
    : null;
}

function normalizeVoiceTtsMode(value: unknown): VoiceTtsMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "both" ||
    normalized === "ack" ||
    normalized === "result" ||
    normalized === "off"
    ? normalized
    : null;
}

function normalizeSpeechRate(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, Number(numeric.toFixed(2))));
}

function isStoredVoiceProfile(value: unknown): value is StoredVoiceProfile {
  return typeof value === "object" && value !== null;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function clipOverlayText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function pickRoastLine(stage: VoiceStage, seedText: string): string {
  const ackLines = [
    "Bold request, honestly.",
    "Let’s see what you’ve done to the repo.",
    "You really do keep Amplink busy.",
  ];
  const resultLines = [
    "Against the odds, it worked.",
    "The code survived. Barely.",
    "A suspiciously clean finish.",
  ];
  const lines = stage === "ack" ? ackLines : resultLines;
  return lines[stableHash(seedText) % lines.length] || lines[0] || "";
}

function ensurePrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

function ensureSuffix(value: string, suffix: string): string {
  return value.endsWith(suffix.trim()) ? value : `${value}${suffix}`;
}
