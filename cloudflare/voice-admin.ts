import {
  createElevenLabsTtsSynthesizer,
  createKvTtsCache,
  type TtsPayload,
} from "./voice-core.ts";
import { renderVoiceAdminPage } from "./admin-page.ts";
import {
  buildVoicePreviewOverlay,
  isVoiceProfileInput,
  loadVoiceProfile,
  mergeVoiceProfile,
  saveVoiceProfile,
  type VoiceProfileInput,
  type VoiceStage,
} from "./voice-profile.ts";
import { buildCuratedVoicePresets } from "./voice-presets.ts";
import { resolveUserId } from "./control.ts";

interface VoicePreviewBody {
  stage?: string;
  profile?: VoiceProfileInput;
}

export async function handleVoiceAdminRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/admin") && !url.pathname.startsWith("/api/voice-profile") &&
    !url.pathname.startsWith("/api/voice-preview")) {
    return null;
  }

  if (!isVoiceAdminAuthorized(request, env)) {
    return json({ error: "Unauthorized voice admin request." }, 401);
  }

  if (request.method === "GET" && url.pathname === "/admin") {
    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");
    const profile = await loadVoiceProfile(env, userId);
    return html(
      renderVoiceAdminPage({
        origin: url.origin,
        userId,
        profile,
        token: url.searchParams.get("token")?.trim() || null,
        presets: buildCuratedVoicePresets(env.ELEVENLABS_VOICE_ID),
      }),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/voice-profile") {
    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");
    const profile = await loadVoiceProfile(env, userId);
    return json({ profile });
  }

  if (request.method === "PUT" && url.pathname === "/api/voice-profile") {
    const body = await readJson<VoiceProfileInput>(request);
    if (!body || !isVoiceProfileInput(body)) {
      return json({ error: "Invalid voice profile payload." }, 400);
    }

    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");
    const profile = await saveVoiceProfile(env, userId, body);
    return json({ ok: true, profile });
  }

  if (request.method === "POST" && url.pathname === "/api/voice-preview") {
    const body = await readJson<VoicePreviewBody>(request);
    const userId = resolveUserId(request, env.AMPLINK_DEFAULT_USER || "anonymous");
    const savedProfile = await loadVoiceProfile(env, userId);
    const profile = mergeVoiceProfile(savedProfile, body?.profile ?? {});
    const stage = normalizePreviewStage(body?.stage);
    const overlay = buildVoicePreviewOverlay(profile, stage);
    const tts = await synthesizeVoicePreview(env, profile, overlay.spokenText);
    return json({
      stage,
      spokenText: overlay.spokenText,
      writtenText: overlay.writtenText,
      tts,
    });
  }

  return json({ error: "Unknown voice admin route." }, 404);
}

function isVoiceAdminAuthorized(request: Request, env: CloudflareEnv): boolean {
  if (!env.CONTROL_SHARED_SECRET?.trim()) {
    return true;
  }

  const url = new URL(request.url);
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    url.searchParams.get("token")?.trim() ||
    "";

  return token === env.CONTROL_SHARED_SECRET;
}

async function synthesizeVoicePreview(
  env: CloudflareEnv,
  profile: Pick<VoiceProfileInput, "voiceId" | "speechRate">,
  spokenText: string,
): Promise<TtsPayload | null> {
  const synthesizeSpeech = createElevenLabsTtsSynthesizer({
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: profile.voiceId,
    modelId: env.ELEVENLABS_MODEL_ID,
    speechRate:
      typeof profile.speechRate === "number" ? profile.speechRate : Number(profile.speechRate),
    cache: createKvTtsCache(env.AMPLINK_VOICE_PROFILES),
  });

  return synthesizeSpeech(spokenText);
}

function normalizePreviewStage(value: unknown): VoiceStage {
  return value === "result" ? "result" : "ack";
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

function html(markup: string, status = 200): Response {
  return new Response(markup, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
