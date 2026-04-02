import { afterEach, describe, expect, test } from "bun:test";

import { startRelay } from "./relay.ts";

let relay: { stop: () => void } | null = null;
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0, sockets.length)) {
    try {
      socket.close();
    } catch {
      // Best-effort cleanup for tests.
    }
  }

  relay?.stop();
  relay = null;
});

describe("relay", () => {
  test("replaces stale clients on reconnect and ignores their late frames", async () => {
    const port = randomPort();
    relay = startRelay(port);

    const roomId = crypto.randomUUID();
    const bridge = await connectSocket(
      `ws://127.0.0.1:${port}?room=${roomId}&role=bridge&key=test-bridge`,
    );
    const clientA = await connectSocket(
      `ws://127.0.0.1:${port}?room=${roomId}&role=client`,
    );

    const clientAClosed = waitForClose(clientA);
    const bridgeMessages: string[] = [];
    bridge.addEventListener("message", (event) => {
      bridgeMessages.push(String(event.data));
    });

    const clientB = await connectSocket(
      `ws://127.0.0.1:${port}?room=${roomId}&role=client`,
    );

    const closeEvent = await clientAClosed;
    expect(closeEvent.code).toBe(4002);
    expect(closeEvent.reason).toBe("Replaced by new client");

    try {
      clientA.send("stale-client-frame");
    } catch {
      // Expected once the stale socket is closed locally.
    }

    clientB.send("fresh-client-frame");
    await waitFor(() => bridgeMessages.includes("fresh-client-frame"));

    expect(bridgeMessages).not.toContain("stale-client-frame");

    const clientBMessages: string[] = [];
    clientB.addEventListener("message", (event) => {
      clientBMessages.push(String(event.data));
    });

    bridge.send("bridge-frame");
    await waitFor(() => clientBMessages.includes("bridge-frame"));
  });
});

function randomPort(): number {
  return 19800 + Math.floor(Math.random() * 1000);
}

async function connectSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket connection failed: ${url}`)), {
      once: true,
    });
  });
  return socket;
}

async function waitForClose(socket: WebSocket): Promise<CloseEvent> {
  return await new Promise<CloseEvent>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event), { once: true });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for relay condition");
    }
    await Bun.sleep(20);
  }
}
