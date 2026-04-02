import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { TurnState } from "./src/bridge/state.ts";
import type { DesktopTaskMessage, Session } from "./src/protocol/index.ts";
import {
  buildBridgePrompt,
  extractTurnResult,
  findCompletedTurnId,
  getDesktopListenerConfig,
  loadDesktopListenerEnvFile,
  pickExistingBridgeSession,
} from "./desktop-listener.ts";

function makeTask(overrides: Partial<DesktopTaskMessage> = {}): DesktopTaskMessage {
  return {
    type: "task",
    taskId: "task-1",
    sessionId: "voice-session-1",
    userId: "demo-user",
    prompt: {
      text: "open the relay logs",
    },
    quickReply: "Opening the relay logs.",
    intent: {
      intent: "command",
      reply: "Opening the relay logs.",
      shouldDispatch: true,
      dispatchPrompt: "open the relay logs",
      confidence: 0.92,
    },
    history: [],
    requestedAt: "2026-03-31T12:00:00.000Z",
    ...overrides,
  };
}

describe("desktop listener helpers", () => {
  test("prefers an explicit target session when one is present", () => {
    const sessions: Session[] = [
      {
        id: "desktop-a",
        name: "A",
        adapterType: "codex",
        status: "active",
      },
      {
        id: "desktop-b",
        name: "B",
        adapterType: "codex",
        status: "active",
      },
    ];

    const selected = pickExistingBridgeSession(
      sessions,
      makeTask({ targetSessionId: "desktop-b" }),
    );

    expect(selected?.id).toBe("desktop-b");
  });

  test("falls back to the only active session", () => {
    const sessions: Session[] = [
      {
        id: "desktop-only",
        name: "Only",
        adapterType: "codex",
        status: "active",
      },
    ];

    const selected = pickExistingBridgeSession(sessions, makeTask());

    expect(selected?.id).toBe("desktop-only");
  });

  test("builds a bridge prompt with voice metadata", () => {
    const prompt = buildBridgePrompt(makeTask(), "desktop-session-1");

    expect(prompt).toMatchObject({
      sessionId: "desktop-session-1",
      text: "open the relay logs",
    });
    expect(prompt.providerOptions).toMatchObject({
      source: "cloudflare-voice",
      voiceSessionId: "voice-session-1",
      voiceUserId: "demo-user",
      bridgeDispatch: true,
    });
  });

  test("extracts text output from a completed turn", () => {
    const turn: TurnState = {
      id: "turn-1",
      status: "completed",
      startedAt: Date.now(),
      blocks: [
        {
          status: "completed",
          block: {
            id: "block-1",
            turnId: "turn-1",
            index: 0,
            status: "completed",
            type: "text",
            text: "Relay logs summarized here.",
          },
        },
      ],
    };

    expect(extractTurnResult(turn)).toBe("Relay logs summarized here.");
  });

  test("finds the first completed turn after a new turn starts", () => {
    const turnId = findCompletedTurnId([
      {
        seq: 10,
        event: {
          event: "session:update",
          session: {
            id: "desktop-session-1",
            name: "Desktop",
            adapterType: "codex",
            status: "active",
          },
        },
      },
      {
        seq: 11,
        event: {
          event: "turn:start",
          sessionId: "desktop-session-1",
          turn: {
            id: "turn-123",
            sessionId: "desktop-session-1",
            status: "started",
            startedAt: "2026-04-01T05:05:00.000Z",
            blocks: [],
          },
        },
      },
      {
        seq: 12,
        event: {
          event: "turn:end",
          sessionId: "desktop-session-1",
          turnId: "turn-123",
          status: "completed",
        },
      },
    ]);

    expect(turnId).toBe("turn-123");
  });

  test("reads listener config from the environment", () => {
    const config = getDesktopListenerConfig({
      AMPLINK_CONTROL_BASE_URL: "wss://amplink.arach.workers.dev",
      AMPLINK_DESKTOP_LISTENER_TOKEN: "TEST_TOKEN",
      AMPLINK_BRIDGE_URL: "ws://127.0.0.1:7888",
      AMPLINK_LISTENER_RECONNECT_MS: "5000",
      AMPLINK_LISTENER_RPC_TIMEOUT_MS: "15000",
      AMPLINK_LISTENER_TASK_TIMEOUT_MS: "120000",
      AMPLINK_DESKTOP_ID: "desktop-dev",
    });

    expect(config).toMatchObject({
      controlUrl: "wss://amplink.arach.workers.dev/listen?token=TEST_TOKEN",
      bridgeUrl: "ws://127.0.0.1:7888",
      reconnectMs: 5000,
      rpcTimeoutMs: 15000,
      taskTimeoutMs: 120000,
      desktopId: "desktop-dev",
    });
  });

  test("loads .env style values without overriding explicit env", () => {
    const dir = mkdtempSync(join(tmpdir(), "amplink-desktop-listener-"));
    const file = join(dir, ".env.local");
    writeFileSync(
      file,
      [
        "export AMPLINK_CONTROL_BASE_URL=\"wss://amplink.arach.workers.dev\"",
        "export AMPLINK_DESKTOP_LISTENER_TOKEN=\"TEST_TOKEN\"",
        "export AMPLINK_BRIDGE_URL=\"ws://from-file:7888\"",
      ].join("\n"),
    );

    const env = {
      AMPLINK_BRIDGE_URL: "ws://override:9999",
    } as NodeJS.ProcessEnv;

    try {
      loadDesktopListenerEnvFile(file, env);

      expect(env.AMPLINK_CONTROL_BASE_URL).toBe("wss://amplink.arach.workers.dev");
      expect(env.AMPLINK_DESKTOP_LISTENER_TOKEN).toBe("TEST_TOKEN");
      expect(env.AMPLINK_BRIDGE_URL).toBe("ws://override:9999");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
