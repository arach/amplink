// End-to-end integration tests for the Plexus pipeline.
//
// Verifies the full flow: Bridge + echo adapter + WebSocket server + client.
// Uses Bun's built-in WebSocket client to simulate a phone connecting to the
// bridge, sending RPCs, and receiving streamed Plexus events.

import { describe, test, expect, afterEach } from "bun:test";
import { Bridge } from "./bridge/bridge.ts";
import { startBridgeServer } from "./bridge/server.ts";
import { createAdapter as createEcho } from "./adapters/echo.ts";
import type { PlexusEvent } from "./protocol/primitives.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WireMessage {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
  seq?: number;
  event?: PlexusEvent;
}

/** Open a WebSocket to the bridge and return helpers for interacting with it. */
function connectClient(port: number): Promise<{
  ws: WebSocket;
  messages: WireMessage[];
  rpc: (method: string, params?: unknown) => Promise<WireMessage>;
  waitForEvent: (predicate: (events: PlexusEvent[]) => boolean, timeoutMs?: number) => Promise<PlexusEvent[]>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const messages: WireMessage[] = [];
    const ws = new WebSocket(`ws://localhost:${port}`);
    let waiters: Array<() => void> = [];

    function notifyWaiters(): void {
      const copy = waiters.slice();
      waiters = [];
      for (const fn of copy) fn();
    }

    ws.addEventListener("message", (ev) => {
      const msg: WireMessage = JSON.parse(ev.data as string);
      messages.push(msg);
      notifyWaiters();
    });

    ws.addEventListener("open", () => {
      resolve({
        ws,
        messages,

        async rpc(method: string, params?: unknown): Promise<WireMessage> {
          const id = crypto.randomUUID();
          ws.send(JSON.stringify({ id, method, params }));
          const deadline = Date.now() + 5000;
          while (true) {
            const found = messages.find((m) => m.id === id);
            if (found) return found;
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(`RPC timeout for ${method}`);
            await new Promise<void>((res) => {
              const timer = setTimeout(() => {
                waiters = waiters.filter((w) => w !== res);
                res();
              }, Math.min(remaining, 50));
              waiters.push(() => { clearTimeout(timer); res(); });
            });
          }
        },

        async waitForEvent(
          predicate: (events: PlexusEvent[]) => boolean,
          timeoutMs = 5000,
        ): Promise<PlexusEvent[]> {
          const deadline = Date.now() + timeoutMs;
          while (true) {
            const events = messages.filter((m) => m.event).map((m) => m.event!);
            if (predicate(events)) return events;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
              throw new Error(
                `Timed out waiting for event predicate (${messages.length} messages, ${events.length} events)`,
              );
            }
            await new Promise<void>((res) => {
              const timer = setTimeout(() => {
                waiters = waiters.filter((w) => w !== res);
                res();
              }, Math.min(remaining, 50));
              waiters.push(() => { clearTimeout(timer); res(); });
            });
          }
        },

        close() {
          ws.close();
        },
      });
    });

    ws.addEventListener("error", () => {
      reject(new Error("WebSocket connection failed"));
    });
  });
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let bridge: Bridge | null = null;
let server: { stop: () => void } | null = null;
let client: Awaited<ReturnType<typeof connectClient>> | null = null;

afterEach(async () => {
  client?.close();
  client = null;
  if (bridge) {
    await bridge.shutdown();
    bridge = null;
  }
  server?.stop();
  server = null;
});

/** Pick a random port in a range to avoid collisions between parallel test runs. */
function randomPort(): number {
  return 17800 + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("End-to-end pipeline", () => {
  test("session/create via RPC returns a valid session", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const res = await client.rpc("session/create", { adapterType: "echo", name: "test" });

    expect(res.error).toBeUndefined();
    const session = res.result as { id: string; adapterType: string; status: string };
    expect(session.id).toBeDefined();
    expect(session.adapterType).toBe("echo");
    expect(session.status).toBe("active");
  });

  test("prompt/send triggers full turn lifecycle over WebSocket", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    // Create session.
    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "e2e",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    // Send prompt.
    const promptRes = await client.rpc("prompt/send", {
      sessionId: session.id,
      text: "hello world",
    });
    expect(promptRes.error).toBeUndefined();

    // Wait for turn:end to arrive.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
    );

    // Verify turn:start.
    const turnStart = events.find((e) => e.event === "turn:start");
    expect(turnStart).toBeDefined();
    expect((turnStart as any).sessionId).toBe(session.id);

    // Verify reasoning block lifecycle.
    const reasoningStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "reasoning",
    );
    expect(reasoningStart).toBeDefined();
    const reasoningBlockId = (reasoningStart as any).block.id;

    const reasoningDelta = events.find(
      (e) => e.event === "block:delta" && (e as any).blockId === reasoningBlockId,
    );
    expect(reasoningDelta).toBeDefined();
    expect((reasoningDelta as any).text).toBe("Thinking about: hello world");

    const reasoningEnd = events.find(
      (e) => e.event === "block:end" && (e as any).blockId === reasoningBlockId,
    );
    expect(reasoningEnd).toBeDefined();

    // Verify text block lifecycle.
    const textStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "text",
    );
    expect(textStart).toBeDefined();
    const textBlockId = (textStart as any).block.id;

    const textDelta = events.find(
      (e) => e.event === "block:delta" && (e as any).blockId === textBlockId,
    );
    expect(textDelta).toBeDefined();
    expect((textDelta as any).text).toBe("Echo: hello world");

    const textEnd = events.find(
      (e) => e.event === "block:end" && (e as any).blockId === textBlockId,
    );
    expect(textEnd).toBeDefined();

    // Verify action block lifecycle.
    const actionStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "action",
    );
    expect(actionStart).toBeDefined();
    const actionBlock = (actionStart as any).block;
    expect(actionBlock.action.kind).toBe("tool_call");
    expect(actionBlock.action.toolName).toBe("echo");

    const actionEnd = events.find(
      (e) => e.event === "block:end" && (e as any).blockId === actionBlock.id,
    );
    expect(actionEnd).toBeDefined();

    // Verify turn:end arrived with "completed".
    const turnEnd = events.find((e) => e.event === "turn:end");
    expect(turnEnd).toBeDefined();
    expect((turnEnd as any).status).toBe("completed");
  });

  test("session/snapshot returns accumulated state after a turn", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    // Create session and send prompt.
    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "snap",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "snapshot test" });

    // Wait for turn:end.
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));

    // Request snapshot.
    const snapRes = await client.rpc("session/snapshot", { sessionId: session.id });
    expect(snapRes.error).toBeUndefined();

    const snapshot = snapRes.result as {
      session: { id: string };
      turns: Array<{
        id: string;
        status: string;
        blocks: Array<{ block: { type: string; text?: string }; status: string }>;
      }>;
    };

    expect(snapshot.session.id).toBe(session.id);
    expect(snapshot.turns.length).toBeGreaterThanOrEqual(1);

    // The turn should be completed with blocks.
    const turn = snapshot.turns[0]!;
    expect(turn.status).toBe("completed");
    expect(turn.blocks.length).toBe(3);

    // Verify accumulated text in reasoning block.
    const reasoning = turn.blocks.find((b) => b.block.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect((reasoning!.block as any).text).toBe("Thinking about: snapshot test");

    // Verify accumulated text in text block.
    const text = turn.blocks.find((b) => b.block.type === "text");
    expect(text).toBeDefined();
    expect((text!.block as any).text).toBe("Echo: snapshot test");

    // Verify action block.
    const action = turn.blocks.find((b) => b.block.type === "action");
    expect(action).toBeDefined();
    expect((action!.block as any).action.kind).toBe("tool_call");
    expect((action!.block as any).action.toolName).toBe("echo");
  });

  test("turn/interrupt stops a session mid-stream", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    // Create session with a visible delay so we can interrupt mid-stream.
    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "interrupt-test",
      options: { stepDelay: 100 },
    });
    const session = createRes.result as { id: string };

    // Send prompt (this starts the turn asynchronously).
    await client.rpc("prompt/send", { sessionId: session.id, text: "long running" });

    // Wait for turn:start to arrive so we know the turn is in progress.
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:start"));

    // Interrupt.
    const interruptRes = await client.rpc("turn/interrupt", { sessionId: session.id });
    expect(interruptRes.error).toBeUndefined();

    // Wait for turn:end.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
      5000,
    );

    const turnEnd = events.find((e) => e.event === "turn:end");
    expect(turnEnd).toBeDefined();
    expect((turnEnd as any).status).toBe("stopped");
  });

  test("session/list returns active sessions", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    await client.rpc("session/create", { adapterType: "echo", name: "s1" });
    await client.rpc("session/create", { adapterType: "echo", name: "s2" });

    const listRes = await client.rpc("session/list");
    expect(listRes.error).toBeUndefined();
    const sessions = listRes.result as Array<{ name: string }>;
    expect(sessions.length).toBe(2);
  });

  test("session/close removes a session and emits session:closed", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const createRes = await client.rpc("session/create", { adapterType: "echo", name: "doomed" });
    const session = createRes.result as { id: string };

    const closeRes = await client.rpc("session/close", { sessionId: session.id });
    expect(closeRes.error).toBeUndefined();

    // Wait for the session:closed event.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "session:closed"),
      2000,
    );
    expect(events.some((e) => e.event === "session:closed")).toBe(true);

    // List should be empty.
    const listRes = await client.rpc("session/list");
    expect((listRes.result as any[]).length).toBe(0);
  });

  test("unknown RPC method returns error", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const res = await client.rpc("nonexistent/method");
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  test("creating session with unknown adapter type returns error", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const res = await client.rpc("session/create", { adapterType: "nonexistent" });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("Unknown adapter type");
  });

  test("events carry monotonic sequence numbers", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "seq-test",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "seqcheck" });

    // Wait for turn:end.
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));

    // Check that seq numbers in event messages are monotonically increasing.
    const seqMessages = client.messages.filter((m) => m.seq !== undefined && m.seq! > 0);
    expect(seqMessages.length).toBeGreaterThan(0);

    for (let i = 1; i < seqMessages.length; i++) {
      expect(seqMessages[i]!.seq!).toBeGreaterThan(seqMessages[i - 1]!.seq!);
    }
  });

  test("bridge/status returns session summaries", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    await client.rpc("session/create", {
      adapterType: "echo",
      name: "status-test",
      options: { stepDelay: 0 },
    });

    const statusRes = await client.rpc("bridge/status");
    expect(statusRes.error).toBeUndefined();
    const result = statusRes.result as { sessions: Array<{ name: string; sessionId: string }> };
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0]!.name).toBe("status-test");
  });

  test("sync/replay returns buffered events", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "replay-test",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "replay" });

    // Wait for turn:end.
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));

    // Get replay from seq 0.
    const replayRes = await client.rpc("sync/replay", { lastSeq: 0 });
    expect(replayRes.error).toBeUndefined();
    const result = replayRes.result as { events: Array<{ seq: number; event: PlexusEvent }> };
    expect(result.events.length).toBeGreaterThan(0);

    // Check that replayed events include the expected types.
    const replayedTypes = result.events.map((e) => e.event.event);
    expect(replayedTypes).toContain("turn:start");
    expect(replayedTypes).toContain("turn:end");
  });

  test("prompt/send to nonexistent session returns error", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const res = await client.rpc("prompt/send", {
      sessionId: "nonexistent",
      text: "nope",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("No session");
  });
});

// ---------------------------------------------------------------------------
// Approval flow tests
// ---------------------------------------------------------------------------

describe("Approval primitives", () => {
  test("echo adapter with requireApproval emits awaiting_approval, approve transitions to completed", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    // Create session with approval required.
    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "approval-test",
      options: { stepDelay: 0, requireApproval: true },
    });
    const session = createRes.result as { id: string };

    // Send prompt.
    await client.rpc("prompt/send", { sessionId: session.id, text: "test approval" });

    // Wait for the approval event.
    const eventsBeforeDecision = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "block:action:approval"),
    );

    const approvalEvent = eventsBeforeDecision.find((e) => e.event === "block:action:approval") as any;
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent.approval.version).toBe(1);
    expect(approvalEvent.approval.risk).toBe("low");

    // Get the turn and block IDs.
    const turnStart = eventsBeforeDecision.find((e) => e.event === "turn:start") as any;
    const turnId = turnStart.turn.id;
    const blockId = approvalEvent.blockId;

    // Verify the action is in awaiting_approval via snapshot.
    const snapRes = await client.rpc("session/snapshot", { sessionId: session.id });
    const snapshot = snapRes.result as any;
    const actionBlock = snapshot.turns[0].blocks.find((b: any) => b.block.type === "action");
    expect(actionBlock.block.action.status).toBe("awaiting_approval");
    expect(actionBlock.block.action.approval.version).toBe(1);

    // Approve.
    const decideRes = await client.rpc("action/decide", {
      sessionId: session.id,
      turnId,
      blockId,
      version: 1,
      decision: "approve",
    });
    expect(decideRes.error).toBeUndefined();
    expect((decideRes.result as any).ok).toBe(true);

    // Wait for turn:end.
    const allEvents = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
    );

    // Verify the action went through running -> completed.
    const statusEvents = allEvents.filter(
      (e) => e.event === "block:action:status" && (e as any).blockId === blockId,
    ) as any[];
    const statuses = statusEvents.map((e: any) => e.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("completed");

    // Turn should have completed.
    const turnEnd = allEvents.find((e) => e.event === "turn:end") as any;
    expect(turnEnd.status).toBe("completed");
  });

  test("deny transitions action to failed", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "deny-test",
      options: { stepDelay: 0, requireApproval: true },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "deny me" });

    // Wait for approval event.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "block:action:approval"),
    );

    const approvalEvent = events.find((e) => e.event === "block:action:approval") as any;
    const turnStart = events.find((e) => e.event === "turn:start") as any;

    // Deny.
    const decideRes = await client.rpc("action/decide", {
      sessionId: session.id,
      turnId: turnStart.turn.id,
      blockId: approvalEvent.blockId,
      version: 1,
      decision: "deny",
      reason: "Too risky",
    });
    expect(decideRes.error).toBeUndefined();

    // Wait for turn:end.
    const allEvents = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
    );

    // Action should have been marked failed.
    const statusEvents = allEvents.filter(
      (e) => e.event === "block:action:status" && (e as any).blockId === approvalEvent.blockId,
    ) as any[];
    expect(statusEvents.some((e: any) => e.status === "failed")).toBe(true);

    // Block should end as failed.
    const blockEnd = allEvents.find(
      (e) => e.event === "block:end" && (e as any).blockId === approvalEvent.blockId,
    ) as any;
    expect(blockEnd).toBeDefined();
    expect(blockEnd.status).toBe("failed");
  });

  test("stale version is rejected", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "stale-test",
      options: { stepDelay: 0, requireApproval: true },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "stale check" });

    // Wait for approval event.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "block:action:approval"),
    );

    const approvalEvent = events.find((e) => e.event === "block:action:approval") as any;
    const turnStart = events.find((e) => e.event === "turn:start") as any;

    // Send decide with wrong version.
    const staleRes = await client.rpc("action/decide", {
      sessionId: session.id,
      turnId: turnStart.turn.id,
      blockId: approvalEvent.blockId,
      version: 999, // Wrong version.
      decision: "approve",
    });
    expect(staleRes.error).toBeDefined();
    expect(staleRes.error!.code).toBe(-32010);
    expect(staleRes.error!.message).toBe("Stale approval version");

    // Clean up: approve with correct version so the turn can finish.
    await client.rpc("action/decide", {
      sessionId: session.id,
      turnId: turnStart.turn.id,
      blockId: approvalEvent.blockId,
      version: 1,
      decision: "approve",
    });
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));
  });

  test("action/decide on nonexistent session returns error", async () => {
    const port = randomPort();
    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port);
    client = await connectClient(port);

    const res = await client.rpc("action/decide", {
      sessionId: "nonexistent",
      turnId: "t1",
      blockId: "b1",
      version: 1,
      decision: "approve",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32001);
  });
});
