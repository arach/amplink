import { afterEach, describe, expect, test } from "bun:test";

import {
  dispatchToDesktop,
  handleControlRequest,
  resolveUserId,
} from "./control.ts";
import {
  FakeDurableObjectNamespace,
  FakeKVNamespace,
  makeCloudflareEnv,
} from "./test-helpers.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("control routes", () => {
  test("resolves user IDs from request headers", () => {
    const request = new Request("https://example.com/sessions", {
      headers: { "x-amplink-user": "demo-user" },
    });

    expect(resolveUserId(request, "fallback")).toBe("demo-user");
  });

  test("registers and looks up a desktop endpoint", async () => {
    const env = makeCloudflareEnv({
      AMPLINK_DESKTOPS: new FakeKVNamespace() as unknown as KVNamespace,
    });

    const registerRequest = new Request("https://example.com/control/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "demo-user",
        sessionId: "session-1",
        endpoint: "https://desktop.example.com/dispatch",
      }),
    });

    const registerResponse = await handleControlRequest(registerRequest, env);
    expect(registerResponse?.status).toBe(200);

    const lookupRequest = new Request(
      "https://example.com/control/desktop?user=demo-user&session=session-1",
    );
    const lookupResponse = await handleControlRequest(lookupRequest, env);
    expect(lookupResponse).not.toBeNull();
    const lookupPayload = await (lookupResponse as Response).json() as {
      registration: {
        userId: string;
        sessionId?: string;
        endpoint: string;
        registeredAt: string;
      } | null;
    };
    expect(lookupPayload.registration?.userId).toBe("demo-user");
    expect(lookupPayload.registration?.sessionId).toBe("session-1");
    expect(lookupPayload.registration?.endpoint).toBe("https://desktop.example.com/dispatch");
    expect(typeof lookupPayload.registration?.registeredAt).toBe("string");
  });

  test("requires authorization for control routes when a shared secret is set", async () => {
    const env = makeCloudflareEnv({
      CONTROL_SHARED_SECRET: "top-secret",
      AMPLINK_DESKTOPS: new FakeKVNamespace() as unknown as KVNamespace,
    });

    const response = await handleControlRequest(
      new Request("https://example.com/control/desktop"),
      env,
    );

    expect(response?.status).toBe(401);
  });

  test("routes listen websocket upgrades to the control durable object", async () => {
    const namespace = new FakeDurableObjectNamespace();
    const env = makeCloudflareEnv({
      DESKTOP_LISTENER_TOKEN: "TEST_TOKEN",
      AMPLINK_CONTROL: namespace as unknown as CloudflareEnv["AMPLINK_CONTROL"],
    });

    const response = await handleControlRequest(
      new Request("https://example.com/listen?token=TEST_TOKEN", {
        headers: { upgrade: "websocket" },
      }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(namespace.lastName).toBe("TEST_TOKEN");
    expect(namespace.lastRequest).not.toBeNull();
    expect(new URL(namespace.lastRequest!.url).pathname).toBe("/connect");
  });

  test("dispatches to the registered desktop endpoint with auth headers", async () => {
    const kv = new FakeKVNamespace();
    const env = makeCloudflareEnv({
      CONTROL_SHARED_SECRET: "top-secret",
      AMPLINK_DESKTOPS: kv as unknown as KVNamespace,
      AMPLINK_CONTROL: undefined as unknown as CloudflareEnv["AMPLINK_CONTROL"],
    });

    await kv.put(
      "desktop:user:demo-user",
      JSON.stringify({
        userId: "demo-user",
        endpoint: "https://desktop.example.com/dispatch",
        registeredAt: "2026-04-01T00:00:00Z",
      }),
    );

    let capturedRequest: Request | null = null;
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      capturedRequest = new Request(input, init);
      return new Response("ok", { status: 202 });
    }) as unknown as typeof fetch;

    const result = await dispatchToDesktop(env, {
      source: "cloudflare-voice",
      sessionId: "session-1",
      userId: "demo-user",
      prompt: { sessionId: "session-1", text: "open logs" },
      quickReply: "Opening logs.",
      intent: {
        intent: "command",
        reply: "Opening logs.",
        shouldDispatch: true,
        dispatchPrompt: "open logs",
        confidence: 0.88,
      },
      history: [],
      requestedAt: "2026-04-01T00:00:00Z",
    });

    expect(result).toEqual({
      queued: true,
      endpoint: "https://desktop.example.com/dispatch",
      status: 202,
      route: "http-endpoint",
    });
    const request = capturedRequest as unknown as Request;
    expect(request.headers.get("authorization")).toBe("Bearer top-secret");
    expect(request.headers.get("x-amplink-source")).toBe("cloudflare-voice");
  });

  test("dispatches through the control hub when a listener token is configured", async () => {
    const namespace = new FakeDurableObjectNamespace();
    namespace.response = new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });

    const env = makeCloudflareEnv({
      DESKTOP_LISTENER_TOKEN: "TEST_TOKEN",
      AMPLINK_CONTROL: namespace as unknown as CloudflareEnv["AMPLINK_CONTROL"],
    });

    const result = await dispatchToDesktop(env, {
      source: "cloudflare-voice",
      sessionId: "voice-session-1",
      userId: "demo-user",
      prompt: { text: "open logs" },
      quickReply: "Opening logs.",
      intent: {
        intent: "command",
        reply: "Opening logs.",
        shouldDispatch: true,
        dispatchPrompt: "open logs",
        confidence: 0.88,
      },
      history: [],
      requestedAt: "2026-04-01T00:00:00Z",
    });

    expect(result).toEqual({
      queued: true,
      endpoint: "control:TEST_TOKEN",
      status: 202,
      route: "control-websocket",
      taskId: undefined,
      error: undefined,
    });
    expect(namespace.lastName).toBe("TEST_TOKEN");
    expect(namespace.lastRequest).not.toBeNull();
    expect(new URL(namespace.lastRequest!.url).pathname).toBe("/dispatch");
  });
});
