import { describe, expect, test } from "bun:test";

import {
  applyVoiceProfileToOverlay,
  buildDefaultVoiceProfile,
  mergeVoiceProfile,
} from "./voice-profile.ts";

describe("voice-profile", () => {
  test("defaults speech rate to normal pace", () => {
    const profile = buildDefaultVoiceProfile(
      { ELEVENLABS_VOICE_ID: "CwhRBWXzGAHq8TQ4Fs17" },
      "demo-user",
    );

    expect(profile.speechRate).toBe(1);
  });

  test("clamps speech rate to the supported range", () => {
    const profile = mergeVoiceProfile(
      buildDefaultVoiceProfile({ ELEVENLABS_VOICE_ID: "CwhRBWXzGAHq8TQ4Fs17" }, "demo-user"),
      {
        speechRate: 4,
      },
    );

    expect(profile.speechRate).toBe(1.2);
  });

  test("applies roast persona to acknowledgement overlays", () => {
    const profile = mergeVoiceProfile(
      buildDefaultVoiceProfile({ ELEVENLABS_VOICE_ID: "CwhRBWXzGAHq8TQ4Fs17" }, "demo-user"),
      {
        persona: "roast",
        roastFrequency: "sometimes",
      },
    );

    const overlay = applyVoiceProfileToOverlay(
      profile,
      {
        presentation: "overlay",
        spokenText: "I’ll open the relay logs for you.",
        writtenText: "I’ll open the relay logs for you.",
      },
      "ack",
      "open the relay logs",
    );

    expect(overlay.spokenText).toContain("Fine.");
    expect(overlay.spokenText).toContain("relay logs");
  });
});
