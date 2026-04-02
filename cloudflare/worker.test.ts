import { describe, expect, mock, test } from "bun:test";
import {
  FakeD1Database,
  FakeDurableObjectNamespace,
  FakeKVNamespace,
  makeCloudflareEnv,
} from "./test-helpers.ts";

mock.module("cloudflare:workers", () => ({
  DurableObject: class DurableObjectTestShim<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;

    constructor(ctx: DurableObjectState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { handleWorkerFetch } = await import("./worker-app.ts");

describe("cloudflare worker routes", () => {
  test("creates sessions in D1 and returns a websocket URL", async () => {
    const db = new FakeD1Database();
    const env = makeCloudflareEnv({
      DB: db as unknown as D1Database,
      AMPLINK_SESSION: new FakeDurableObjectNamespace() as unknown as CloudflareEnv["AMPLINK_SESSION"],
    });

    const response = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/start-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-amplink-user": "demo-user",
        },
        body: JSON.stringify({ title: "Demo voice session" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    const payload = await response.json() as {
      session: {
        userId: string;
        title: string;
      };
      websocketUrl: string;
    };
    expect(payload.session.userId).toBe("demo-user");
    expect(payload.session.title).toBe("Demo voice session");
    expect(payload.websocketUrl).toContain("wss://amplink.arach.workers.dev/ws?");
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.user_id).toBe("demo-user");
  });

  test("lists sessions for the requesting user", async () => {
    const db = new FakeD1Database();
    db.rows.push(
      {
        id: "session-1",
        user_id: "demo-user",
        title: "Newest",
        status: "active",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:02:00Z",
        last_message_at: "2026-04-01T00:02:00Z",
        metadata: JSON.stringify({ source: "cloudflare-voice" }),
      },
      {
        id: "session-2",
        user_id: "someone-else",
        title: "Other",
        status: "idle",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:01:00Z",
        last_message_at: null,
        metadata: "{}",
      },
    );

    const env = makeCloudflareEnv({
      DB: db as unknown as D1Database,
    });

    const response = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/sessions", {
        headers: { "x-amplink-user": "demo-user" },
      }),
      env,
    );

    const payload = await response.json() as {
      userId: string;
      sessions: Array<{
        id: string;
        title: string;
        status: string;
      }>;
    };
    expect(response.status).toBe(200);
    expect(payload.userId).toBe("demo-user");
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({
      id: "session-1",
      title: "Newest",
      status: "active",
    });
  });

  test("routes websocket upgrades to the session durable object", async () => {
    const db = new FakeD1Database();
    db.rows.push({
      id: "session-1",
      user_id: "demo-user",
      title: "Demo",
      status: "created",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
      last_message_at: null,
      metadata: "{}",
    });

    const namespace = new FakeDurableObjectNamespace();
    const env = makeCloudflareEnv({
      DB: db as unknown as D1Database,
      AMPLINK_SESSION: namespace as unknown as CloudflareEnv["AMPLINK_SESSION"],
    });

    const response = await handleWorkerFetch(
      new Request(
        "https://amplink.arach.workers.dev/ws?session=session-1&device=mobile&user=demo-user",
        {
          headers: { upgrade: "websocket" },
        },
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(namespace.lastName).toBe("session-1");
    expect(namespace.lastRequest).not.toBeNull();
    expect(new URL(namespace.lastRequest!.url).pathname).toBe("/connect");
  });

  test("routes relay websocket upgrades to the relay durable object", async () => {
    const namespace = new FakeDurableObjectNamespace();
    const env = makeCloudflareEnv({
      AMPLINK_RELAY_ROOM: namespace as unknown as CloudflareEnv["AMPLINK_RELAY_ROOM"],
    });

    const response = await handleWorkerFetch(
      new Request(
        "https://amplink.arach.workers.dev/relay?room=room-123&role=bridge&key=bridge-key",
        {
          headers: { upgrade: "websocket" },
        },
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(namespace.lastName).toBe("room-123");
    expect(namespace.lastRequest).not.toBeNull();
    const forwardedUrl = new URL(namespace.lastRequest!.url);
    expect(forwardedUrl.pathname).toBe("/connect");
    expect(forwardedUrl.searchParams.get("room")).toBe("room-123");
    expect(forwardedUrl.searchParams.get("role")).toBe("bridge");
    expect(forwardedUrl.searchParams.get("key")).toBe("bridge-key");
  });

  test("resolves relay rooms from the desktops KV binding", async () => {
    const desktops = new FakeKVNamespace();
    await desktops.put("relay-room:bridge-key", "room-xyz");
    const env = makeCloudflareEnv({
      AMPLINK_DESKTOPS: desktops as unknown as KVNamespace,
    });

    const response = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/relay/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bridgePublicKey: "bridge-key" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { room: string };
    expect(payload.room).toBe("room-xyz");
  });

  test("reads and updates a voice profile through the worker api", async () => {
    const env = makeCloudflareEnv({
      AMPLINK_VOICE_PROFILES: new FakeKVNamespace() as unknown as KVNamespace,
    });

    const saveResponse = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/api/voice-profile?user=demo-user", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persona: "roast",
          ttsMode: "ack",
          voiceId: "voice-xyz",
          roastFrequency: "sometimes",
          customStyle: "Keep it playful but brief.",
        }),
      }),
      env,
    );

    expect(saveResponse.status).toBe(200);
    const saved = await saveResponse.json() as { profile: { persona: string; ttsMode: string; voiceId: string } };
    expect(saved.profile).toMatchObject({
      persona: "roast",
      ttsMode: "ack",
      voiceId: "voice-xyz",
    });

    const loadResponse = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/api/voice-profile?user=demo-user"),
      env,
    );

    expect(loadResponse.status).toBe(200);
    const loaded = await loadResponse.json() as { profile: { persona: string; roastFrequency: string; customStyle: string } };
    expect(loaded.profile).toMatchObject({
      persona: "roast",
      roastFrequency: "sometimes",
      customStyle: "Keep it playful but brief.",
    });

    const partialSaveResponse = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/api/voice-profile?user=demo-user", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          speechRate: 1.15,
        }),
      }),
      env,
    );

    expect(partialSaveResponse.status).toBe(200);
    const partialSaved = await partialSaveResponse.json() as {
      profile: {
        persona: string;
        ttsMode: string;
        voiceId: string;
        speechRate: number;
      };
    };
    expect(partialSaved.profile).toMatchObject({
      persona: "roast",
      ttsMode: "ack",
      voiceId: "voice-xyz",
      speechRate: 1.15,
    });
  });

  test("serves the voice admin page", async () => {
    const env = makeCloudflareEnv({
      AMPLINK_VOICE_PROFILES: new FakeKVNamespace() as unknown as KVNamespace,
    });

    const response = await handleWorkerFetch(
      new Request("https://amplink.arach.workers.dev/admin?user=demo-user"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("Voice Admin");
    expect(body).toContain("Receipt + Completion");
    expect(body).toContain("Vault Alpha");
    expect(body).toContain("Vault Beta");
  });
});
