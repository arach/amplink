import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Bridge } from "./bridge.ts";
import { createAdapter as createEcho } from "../adapters/echo.ts";
import type { AmplinkEvent } from "../protocol/index.ts";
import { resolveWorkspacePath, startBridgeServer } from "./server.ts";

const tempDirs: string[] = [];
const servers: Array<{ stop: () => void }> = [];
const bridges: Bridge[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  while (servers.length > 0) {
    servers.pop()?.stop();
  }

  void Promise.allSettled(bridges.splice(0, bridges.length).map((bridge) => bridge.shutdown()));
});

describe("resolveWorkspacePath", () => {
  test("resolves relative paths inside the configured workspace root", () => {
    const root = makeTempDir("amplink-workspace-");
    const project = join(root, "project-a");
    mkdirSync(project);

    expect(resolveWorkspacePath(root, "project-a")).toBe(realpathSync(project));
  });

  test("rejects parent traversal outside the configured workspace root", () => {
    const base = makeTempDir("amplink-workspace-parent-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);

    expect(() => resolveWorkspacePath(root, "../outside")).toThrow(
      "Path escapes workspace root",
    );
  });

  test("rejects symlink targets that escape the configured workspace root", () => {
    const base = makeTempDir("amplink-workspace-symlink-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "linked-outside"));

    expect(() => resolveWorkspacePath(root, "linked-outside")).toThrow(
      "Path escapes workspace root",
    );
  });
});

describe("dispatch endpoint", () => {
  test("routes a dispatch payload into the only active Amplink session", async () => {
    const bridge = new Bridge({ adapters: { echo: createEcho } });
    bridges.push(bridge);

    const session = await bridge.createSession("echo", {
      name: "dispatch-target",
      options: { stepDelay: 0 },
    });

    const port = randomPort();
    const server = startBridgeServer(bridge, port);
    servers.push(server);

    const events = await collectUntil(
      bridge,
      async () => {
        const response = await fetch(`http://127.0.0.1:${port}/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "cloudflare-voice",
            sessionId: "voice-session-1",
            voiceSessionId: "voice-session-1",
            userId: "demo-user",
            prompt: {
              text: "open the relay logs",
              providerOptions: { source: "smoke" },
            },
            quickReply: "Opening the relay logs.",
            intent: {
              intent: "command",
              reply: "Opening the relay logs.",
              shouldDispatch: true,
              dispatchPrompt: "open the relay logs",
              confidence: 0.82,
            },
            history: [],
            requestedAt: "2026-04-01T00:00:00Z",
          }),
        });

        expect(response.status).toBe(202);
        const payload = await response.json() as {
          ok: boolean;
          createdSession: boolean;
          session: { id: string };
        };
        expect(payload.ok).toBe(true);
        expect(payload.createdSession).toBe(false);
        expect(payload.session.id).toBe(session.id);
      },
      (seen) => seen.some((event) => event.event === "turn:end"),
    );

    const turnStart = events.find((event) => event.event === "turn:start") as
      | Extract<AmplinkEvent, { event: "turn:start" }>
      | undefined;
    expect(turnStart?.sessionId).toBe(session.id);
  });

  test("rejects dispatch when multiple active sessions exist and no explicit target is provided", async () => {
    const bridge = new Bridge({ adapters: { echo: createEcho } });
    bridges.push(bridge);

    await bridge.createSession("echo", { name: "one", options: { stepDelay: 0 } });
    await bridge.createSession("echo", { name: "two", options: { stepDelay: 0 } });

    const port = randomPort();
    const server = startBridgeServer(bridge, port);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "cloudflare-voice",
        sessionId: "voice-session-2",
        userId: "demo-user",
        prompt: { text: "check status" },
        quickReply: "Checking status.",
        intent: {
          intent: "status",
          reply: "Checking status.",
          shouldDispatch: true,
          dispatchPrompt: "check status",
          confidence: 0.91,
        },
        history: [],
        requestedAt: "2026-04-01T00:00:00Z",
      }),
    });

    expect(response.status).toBe(409);
    const payload = await response.json() as { activeSessions: Array<{ id: string }> };
    expect(payload.activeSessions).toHaveLength(2);
  });

  test("enforces the optional shared secret on /dispatch", async () => {
    const bridge = new Bridge({ adapters: { echo: createEcho } });
    bridges.push(bridge);

    const port = randomPort();
    const server = startBridgeServer(bridge, port, {
      dispatchSecret: "top-secret",
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "cloudflare-voice",
        sessionId: "voice-session-3",
        userId: "demo-user",
        prompt: { text: "hello" },
        quickReply: "Hello.",
        intent: {
          intent: "intake",
          reply: "Hello.",
          shouldDispatch: false,
          dispatchPrompt: "hello",
          confidence: 0.95,
        },
        history: [],
        requestedAt: "2026-04-01T00:00:00Z",
      }),
    });

    expect(response.status).toBe(401);
  });
});

function randomPort(): number {
  return 18800 + Math.floor(Math.random() * 1000);
}

async function collectUntil(
  bridge: Bridge,
  trigger: () => Promise<void>,
  predicate: (events: AmplinkEvent[]) => boolean,
  timeoutMs = 5000,
): Promise<AmplinkEvent[]> {
  const events: AmplinkEvent[] = [];
  let resolveWaiter: (() => void) | null = null;
  const unsub = bridge.onEvent((sequenced) => {
    events.push(sequenced.event);
    resolveWaiter?.();
  });

  try {
    await trigger();
    const deadline = Date.now() + timeoutMs;
    while (!predicate(events)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for bridge events");
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolveWaiter = null;
          resolve();
        }, Math.min(remaining, 50));

        resolveWaiter = () => {
          clearTimeout(timer);
          resolveWaiter = null;
          resolve();
        };
      });
    }

    return events;
  } finally {
    unsub();
  }
}
