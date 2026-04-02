import { describe, expect, test } from "bun:test";

import {
  appendConversationEntry,
  buildFallbackIntent,
  buildFallbackDesktopResultSummary,
  buildVoiceTrace,
  createElevenLabsTtsSynthesizer,
  createWorkersAiIntentAnalyzer,
  createWorkersAiResultSummarizer,
  parseIncomingVoiceMessage,
  resolveVoiceTtsMode,
  runVoiceTurn,
  shouldSynthesizeVoiceStage,
  type TtsPayload,
} from "./voice-core.ts";

describe("voice-core", () => {
  test("parses plain text messages as voice input", () => {
    expect(parseIncomingVoiceMessage("open the logs")).toEqual({
      type: "voice.input",
      text: "open the logs",
    });
  });

  test("parses JSON envelopes for ping and voice input", () => {
    expect(parseIncomingVoiceMessage('{"type":"ping","requestId":"req-1"}')).toEqual({
      type: "ping",
      requestId: "req-1",
    });

    expect(
      parseIncomingVoiceMessage(
        '{"type":"voice.input","text":"hello","locale":"en-CA","metadata":{"source":"mic"}}',
      ),
    ).toEqual({
      type: "voice.input",
      text: "hello",
      locale: "en-CA",
      metadata: { source: "mic" },
    });
  });

  test("classifies intake locally in the fallback path", () => {
    expect(buildFallbackIntent("hello")).toEqual({
      intent: "intake",
      reply: "I'm here and ready. Tell me what you want Amplink to handle.",
      shouldDispatch: false,
      dispatchPrompt: "hello",
      confidence: 0.92,
    });
  });

  test("limits history to the newest ten messages", () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message-${index}`,
      at: `2026-04-01T00:00:${String(index).padStart(2, "0")}Z`,
    }));

    const next = appendConversationEntry(history, {
      role: "user",
      text: "latest",
      at: "2026-04-01T00:01:00Z",
    });

    expect(next).toHaveLength(10);
    expect(next[0]?.text).toBe("message-1");
    expect(next[9]?.text).toBe("latest");
  });

  test("runs a voice turn with injectable services", async () => {
    const history = Array.from({ length: 9 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `history-${index}`,
      at: `2026-04-01T00:00:${String(index).padStart(2, "0")}Z`,
    }));

    const dispatchCalls: unknown[] = [];
    const result = await runVoiceTurn(
      {
        sessionId: "session-1",
        userId: "user-1",
        text: "open the relay logs",
        requestId: "req-123",
        receivedAt: "2026-04-01T00:10:00Z",
        locale: "en-CA",
        metadata: { source: "mic", desktopSessionId: "desktop-session-1" },
        history,
      },
      {
        analyzeIntent: async () => ({
          intent: "command",
          reply: "Opening the relay logs now.",
          shouldDispatch: true,
          dispatchPrompt: "Open the relay logs and summarize failures.",
          confidence: 0.88,
        }),
        synthesizeSpeech: async () => ({
          provider: "elevenlabs",
          voiceId: "voice-1",
          modelId: "eleven_multilingual_v2",
          contentType: "audio/mpeg",
          audioBase64: "QUJD",
        }),
        dispatch: async (payload) => {
          dispatchCalls.push(payload);
          return {
            queued: true,
            status: 202,
            route: "control-websocket",
            taskId: "task-123",
          };
        },
        now: () => "2026-04-01T00:10:01Z",
      },
    );

    expect(result.requestId).toBe("req-123");
    expect(result.text).toBe("Opening the relay logs now.");
    expect(result.spokenText).toBe("Opening the relay logs now.");
    expect(result.writtenText).toBe("Opening the relay logs now.");
    expect(result.presentation).toBe("overlay");
    expect(result.prompt.sessionId).toBe("desktop-session-1");
    expect(result.prompt.text).toBe("Open the relay logs and summarize failures.");
    expect(result.prompt.providerOptions).toEqual({
      source: "cloudflare-voice",
      channel: "voice",
      intent: "command",
      confidence: 0.88,
      quickReply: "Opening the relay logs now.",
      locale: "en-CA",
      voiceMetadata: {
        source: "mic",
        desktopSessionId: "desktop-session-1",
      },
    });
    expect(result.dispatch).toEqual({
      queued: true,
      status: 202,
      route: "control-websocket",
      taskId: "task-123",
    });
    expect(result.trace).toEqual({
      path: "cloudflare+desktop",
      dispatchAttempted: true,
      dispatchQueued: true,
      dispatchRoute: "control-websocket",
      dispatchTaskId: "task-123",
      dispatchError: undefined,
    });
    expect(result.tts?.audioBase64).toBe("QUJD");
    expect(result.history).toHaveLength(10);
    expect(result.history[9]?.text).toBe("Opening the relay logs now.");
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toMatchObject({
      targetSessionId: "desktop-session-1",
      target: { sessionId: "desktop-session-1" },
    });
  });

  test("resolves voice tts modes from metadata aliases", () => {
    expect(resolveVoiceTtsMode({ ttsMode: "ack" })).toBe("ack");
    expect(resolveVoiceTtsMode({ voiceReplyAudioMode: "completion-only" })).toBe("result");
    expect(resolveVoiceTtsMode({ audioMode: "mute" })).toBe("off");
    expect(resolveVoiceTtsMode({})).toBe("both");
  });

  test("knows which voice stages should synthesize", () => {
    expect(shouldSynthesizeVoiceStage("both", "ack")).toBe(true);
    expect(shouldSynthesizeVoiceStage("both", "result")).toBe(true);
    expect(shouldSynthesizeVoiceStage("ack", "ack")).toBe(true);
    expect(shouldSynthesizeVoiceStage("ack", "result")).toBe(false);
    expect(shouldSynthesizeVoiceStage("result", "ack")).toBe(false);
    expect(shouldSynthesizeVoiceStage("result", "result")).toBe(true);
    expect(shouldSynthesizeVoiceStage("off", "ack")).toBe(false);
  });

  test("skips ack tts when the session requests completion-only audio", async () => {
    let synthesizeCalls = 0;
    const result = await runVoiceTurn(
      {
        sessionId: "session-2",
        userId: "user-2",
        text: "check the latest logs",
        metadata: { ttsMode: "result" },
        history: [],
      },
      {
        analyzeIntent: async () => ({
          intent: "command",
          reply: "Checking the logs now.",
          shouldDispatch: true,
          dispatchPrompt: "Check the latest logs.",
          confidence: 0.85,
        }),
        synthesizeSpeech: async () => {
          synthesizeCalls += 1;
          return {
            provider: "elevenlabs",
            voiceId: "voice-1",
            modelId: "eleven_multilingual_v2",
            contentType: "audio/mpeg",
            audioBase64: "QUJD",
          };
        },
        dispatch: async () => ({
          queued: true,
          status: 202,
          route: "control-websocket",
          taskId: "task-456",
        }),
      },
    );

    expect(result.ttsMode).toBe("result");
    expect(result.tts).toBeNull();
    expect(synthesizeCalls).toBe(0);
  });

  test("builds a cloudflare-only trace when dispatch is skipped", () => {
    expect(
      buildVoiceTrace(
        {
          intent: "intake",
          reply: "Hi",
          shouldDispatch: false,
          dispatchPrompt: "hello",
          confidence: 0.9,
        },
        {
          queued: false,
          skipped: true,
          route: "none",
          error: "Intent handled locally without desktop dispatch.",
        },
      ),
    ).toEqual({
      path: "cloudflare-only",
      dispatchAttempted: false,
      dispatchQueued: false,
      dispatchRoute: "none",
      dispatchTaskId: undefined,
      dispatchError: "Intent handled locally without desktop dispatch.",
    });
  });

  test("falls back when Workers AI returns invalid JSON", async () => {
    const analyzeIntent = createWorkersAiIntentAnalyzer({
      run: async () => ({ response: "not-json" }),
    } as Pick<Ai, "run">);

    const result = await analyzeIntent("hello", []);
    expect(result.intent).toBe("intake");
    expect(result.shouldDispatch).toBe(false);
  });

  test("normalizes legacy smalltalk responses from Workers AI to intake", async () => {
    const analyzeIntent = createWorkersAiIntentAnalyzer({
      run: async () => ({
        response: JSON.stringify({
          intent: " SmallTalk ",
          reply: "Hi there.",
          shouldDispatch: true,
          dispatchPrompt: "hello",
          confidence: 0.9,
        }),
      }),
    } as Pick<Ai, "run">);

    const result = await analyzeIntent("hello", []);
    expect(result.intent).toBe("intake");
    expect(result.reply).toBe("Hi there.");
    expect(result.shouldDispatch).toBe(false);
  });

  test("forces non-intake AI results into dispatch receipts", async () => {
    const analyzeIntent = createWorkersAiIntentAnalyzer({
      run: async () => ({
        response: JSON.stringify({
          intent: "question",
          reply: "The desktop agent is powered by Amplink's AI engine.",
          shouldDispatch: false,
          dispatchPrompt: "What agent is running on desktop?",
          confidence: 0.94,
        }),
      }),
    } as Pick<Ai, "run">);

    const result = await analyzeIntent("What agent is running on desktop?", []);

    expect(result.intent).toBe("question");
    expect(result.shouldDispatch).toBe(true);
    expect(result.reply).toBe("I heard your question. I'm passing it to the desktop agent now.");
    expect(result.dispatchPrompt).toBe("What agent is running on desktop?");
  });

  test("encodes ElevenLabs audio payloads as base64", async () => {
    let requestUrl = "";
    let requestBody = "";
    const synthesizeSpeech = createElevenLabsTtsSynthesizer({
      apiKey: "secret",
      voiceId: "voice-123",
      modelId: "eleven_multilingual_v2",
      speechRate: 1.15,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input);
        requestBody = String(init?.body || "");
        return new Response(Uint8Array.from([65, 66, 67]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as unknown as typeof fetch,
    });

    const result = await synthesizeSpeech("hello there");
    expect(requestUrl).toContain("optimize_streaming_latency=3");
    expect(JSON.parse(requestBody)).toMatchObject({
      text: "hello there",
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        speed: 1.15,
      },
    });
    expect(result).toEqual({
      provider: "elevenlabs",
      voiceId: "voice-123",
      modelId: "eleven_multilingual_v2",
      contentType: "audio/mpeg",
      audioBase64: "QUJD",
    });
  });

  test("reuses cached ElevenLabs payloads for repeated voice text", async () => {
    const cache = new Map<string, unknown>();
    let fetchCalls = 0;
    const synthesizeSpeech = createElevenLabsTtsSynthesizer({
      apiKey: "secret",
      voiceId: "voice-123",
      modelId: "eleven_multilingual_v2",
      cache: {
        get: async (key) => (cache.get(key) as Awaited<ReturnType<typeof synthesizeSpeech>> | null) ?? null,
        put: async (key, payload) => {
          cache.set(key, payload);
        },
      },
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response(Uint8Array.from([65, 66, 67]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as unknown as typeof fetch,
    });

    const first = await synthesizeSpeech("  hello there  ");
    const second = await synthesizeSpeech("hello there");

    expect(fetchCalls).toBe(1);
    expect(second).toEqual(first);
  });

  test("does not reuse cached ElevenLabs payloads across different speech rates", async () => {
    const cache = new Map<string, unknown>();
    let fetchCalls = 0;
    const normal = createElevenLabsTtsSynthesizer({
      apiKey: "secret",
      voiceId: "voice-123",
      modelId: "eleven_multilingual_v2",
      speechRate: 1,
      cache: {
        get: async (key: string) => (cache.get(key) as TtsPayload | null) ?? null,
        put: async (key: string, payload: TtsPayload) => {
          cache.set(key, payload);
        },
      },
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response(Uint8Array.from([65, 66, 67]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as unknown as typeof fetch,
    });
    const brisk = createElevenLabsTtsSynthesizer({
      apiKey: "secret",
      voiceId: "voice-123",
      modelId: "eleven_multilingual_v2",
      speechRate: 1.15,
      cache: {
        get: async (key: string) => (cache.get(key) as TtsPayload | null) ?? null,
        put: async (key: string, payload: TtsPayload) => {
          cache.set(key, payload);
        },
      },
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response(Uint8Array.from([65, 66, 67]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as unknown as typeof fetch,
    });

    await normal("hello there");
    await brisk("hello there");

    expect(fetchCalls).toBe(2);
  });

  test("builds a short fallback summary for desktop results", () => {
    expect(
      buildFallbackDesktopResultSummary(
        "Updated the relay config, restarted the listener, and confirmed the bridge reconnected cleanly after the last transport error.",
        "done",
      ),
    ).toEqual({
      presentation: "overlay",
      spokenText:
        "Amplink finished the desktop task. Updated the relay config, restarted the listener, and confirmed the bridge reconnected cleanly after the last…",
      writtenText:
        "Desktop result: Updated the relay config, restarted the listener, and confirmed the bridge reconnected cleanly after the last…",
    });
  });

  test("summarizes desktop results with Workers AI and keeps them as overlays", async () => {
    const summarizeResult = createWorkersAiResultSummarizer({
      run: async () => ({
        response: JSON.stringify({
          spokenText: "Amplink finished and the relay is healthy again.",
          writtenText: "Relay recovered and the desktop task completed.",
        }),
      }),
    } as Pick<Ai, "run">);

    const summary = await summarizeResult(
      "Relay config updated. Desktop listener restarted. The next task completed normally.",
      "done",
    );

    expect(summary).toEqual({
      presentation: "overlay",
      spokenText: "Amplink finished and the relay is healthy again.",
      writtenText: "Relay recovered and the desktop task completed.",
    });
  });
});
