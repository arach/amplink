import type {
  VoicePersona,
  VoiceProfileInput,
  VoiceRoastFrequency,
} from "./voice-profile.ts";
import type { VoiceTtsMode } from "./voice-core.ts";

export interface VoicePreset extends VoiceProfileInput {
  id: string;
  label: string;
  description: string;
  sourceUrl?: string;
}

export function buildCuratedVoicePresets(
  defaultVoiceId: string,
): VoicePreset[] {
  return [
    {
      id: "house",
      label: "House Voice",
      description: "The clean default. Crisp operator delivery with no drama.",
      voiceId: defaultVoiceId,
      speechRate: 1.05,
      persona: "operator",
      ttsMode: "ack",
      roastFrequency: "rare",
      customStyle: "",
    },
    {
      id: "vault-alpha",
      label: "Vault Alpha",
      description: "Dry and a little dangerous. Good for clipped receipts.",
      voiceId: "ruirxsoakN0GWmGNIo04",
      speechRate: 1.12,
      persona: "dry",
      ttsMode: "ack",
      roastFrequency: "off",
      customStyle: "Keep it cool, concise, and a touch sharp.",
      sourceUrl: "https://elevenlabs.io/app/voice-library?voiceId=ruirxsoakN0GWmGNIo04",
    },
    {
      id: "vault-beta",
      label: "Vault Beta",
      description: "Playful roast mode with enough restraint to stay useful.",
      voiceId: "MKlLqCItoCkvdhrxgtLv",
      speechRate: 1.08,
      persona: "roast",
      ttsMode: "ack",
      roastFrequency: "sometimes",
      customStyle: "Play the joke quickly, then get back to the task.",
      sourceUrl: "https://elevenlabs.io/app/voice-library?voiceId=MKlLqCItoCkvdhrxgtLv",
    },
  ];
}
