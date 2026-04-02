interface StartSessionResponse {
  session: {
    id: string;
    userId: string;
    title: string;
    status: string;
  };
  websocketUrl: string;
}

interface SessionsResponse {
  userId: string;
  sessions: Array<{
    id: string;
    title: string;
    status: string;
  }>;
}

interface SessionReadyMessage {
  type: "session.ready";
  sessionId: string;
  history: Array<unknown>;
  connectedClients: number;
  at: string;
}

interface VoiceAckMessage {
  type: "voice.ack";
  requestId: string;
  sessionId: string;
  receivedAt: string;
}

interface VoiceReplyMessage {
  type: "voice.reply";
  requestId: string;
  sessionId: string;
  text: string;
  intent: {
    intent: string;
    shouldDispatch: boolean;
    confidence: number;
  };
  history: Array<{ role: string; text: string; at: string }>;
  tts: null | {
    provider: string;
    voiceId: string;
    modelId: string;
    contentType: string;
    audioBase64: string;
  };
  dispatch: {
    queued: boolean;
    skipped?: boolean;
    status?: number;
    error?: string;
    route?: string;
    taskId?: string;
  };
  trace?: {
    path: string;
    dispatchAttempted: boolean;
    dispatchQueued: boolean;
    dispatchRoute: string;
    dispatchTaskId?: string;
    dispatchError?: string;
  };
  at: string;
}

type SocketMessage = SessionReadyMessage | VoiceAckMessage | VoiceReplyMessage | {
  type: "voice.error";
  requestId?: string;
  sessionId?: string;
  message: string;
};

const BASE_URL = Bun.env.AMPLINK_SMOKE_BASE_URL ?? "https://amplink.arach.workers.dev";
const USER_ID = Bun.env.AMPLINK_SMOKE_USER_ID ?? `smoke-${Date.now()}`;
const TEXT = Bun.env.AMPLINK_SMOKE_TEXT ?? "hello from the live smoke test";
const REQUIRE_TTS = (Bun.env.AMPLINK_SMOKE_REQUIRE_TTS ?? "1") !== "0";
const TIMEOUT_MS = Number(Bun.env.AMPLINK_SMOKE_TIMEOUT_MS ?? "30000");

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(BASE_URL);
  const requestId = crypto.randomUUID();

  logStep(`Starting live smoke against ${baseUrl}`);
  logStep(`Using smoke user ${USER_ID}`);

  const startResponse = await fetchJson<StartSessionResponse>(
    new URL("/start-session", baseUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-amplink-user": USER_ID,
      },
      body: JSON.stringify({
        title: `Smoke test ${new Date().toISOString()}`,
        metadata: {
          source: "smoke-cloudflare",
        },
      }),
    },
  );

  assert(startResponse.session.id, "start-session did not return a session ID");
  assert(startResponse.websocketUrl, "start-session did not return a websocket URL");
  logStep(`Created session ${startResponse.session.id}`);

  const sessionsResponse = await fetchJson<SessionsResponse>(
    new URL("/sessions", baseUrl),
    {
      headers: { "x-amplink-user": USER_ID },
    },
  );

  const listedSession = sessionsResponse.sessions.find(
    (session) => session.id === startResponse.session.id,
  );
  assert(listedSession, "Created session was not returned by GET /sessions");
  logStep(`Verified session listing for ${startResponse.session.id}`);

  const socket = await connectWebSocket(startResponse.websocketUrl, TIMEOUT_MS);

  try {
    const ready = await socket.waitFor<SessionReadyMessage>(
      (message): message is SessionReadyMessage => message.type === "session.ready",
      "session.ready",
    );
    assert(
      ready.sessionId === startResponse.session.id,
      "session.ready referenced the wrong session",
    );
    logStep(`WebSocket connected with ${ready.connectedClients} mobile client(s)`);

    socket.send({
      type: "voice.input",
      requestId,
      text: TEXT,
      locale: "en-CA",
      metadata: {
        source: "smoke-cloudflare",
      },
    });
    logStep(`Sent voice input: "${TEXT}"`);

    const ack = await socket.waitFor<VoiceAckMessage>(
      (message): message is VoiceAckMessage =>
        message.type === "voice.ack" && message.requestId === requestId,
      "voice.ack",
    );
    assert(ack.sessionId === startResponse.session.id, "voice.ack referenced the wrong session");

    const reply = await socket.waitFor<VoiceReplyMessage>(
      (message): message is VoiceReplyMessage =>
        message.type === "voice.reply" && message.requestId === requestId,
      "voice.reply",
    );

    assert(reply.text.trim().length > 0, "voice.reply did not include reply text");
    assert(reply.intent.intent.length > 0, "voice.reply did not include an intent");
    assert(reply.history.length >= 2, "voice.reply history did not include both turns");

    if (REQUIRE_TTS) {
      assert(reply.tts, "voice.reply did not include TTS payload");
      assert(reply.tts.provider === "elevenlabs", "TTS provider was not ElevenLabs");
      assert(reply.tts.audioBase64.length > 0, "TTS payload was empty");
    }

    logStep(`Reply intent: ${reply.intent.intent}`);
    logStep(`Reply text: ${reply.text}`);
    if (reply.tts) {
      logStep(
        `Received ${reply.tts.contentType} audio from ${reply.tts.provider} (${reply.tts.audioBase64.length} base64 chars)`,
      );
    } else {
      logStep("No TTS payload was returned");
    }

    if (reply.dispatch.skipped && reply.dispatch.error) {
      logStep(`Desktop dispatch skipped: ${reply.dispatch.error}`);
    } else if (reply.dispatch.queued) {
      logStep(
        `Desktop dispatch queued via ${reply.dispatch.route ?? "unknown"} with status ${reply.dispatch.status ?? "unknown"}${reply.dispatch.taskId ? ` (task ${reply.dispatch.taskId})` : ""}`,
      );
    }

    if (reply.trace) {
      logStep(
        `Trace path: ${reply.trace.path} (attempted=${reply.trace.dispatchAttempted}, queued=${reply.trace.dispatchQueued}, route=${reply.trace.dispatchRoute}${reply.trace.dispatchTaskId ? `, task=${reply.trace.dispatchTaskId}` : ""})`,
      );
    }

    logStep("Live smoke test passed");
  } finally {
    socket.close();
  }
}

function connectWebSocket(url: string, timeoutMs: number) {
  return new Promise<{
    send: (payload: unknown) => void;
    waitFor: <T extends SocketMessage>(
      predicate: (message: SocketMessage) => message is T,
      label: string,
    ) => Promise<T>;
    close: () => void;
  }>((resolve, reject) => {
    const messages: SocketMessage[] = [];
    const waiters = new Set<() => void>();
    const socket = new WebSocket(url);
    const openTimeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out connecting to ${url}`));
    }, timeoutMs);

    function notify(): void {
      for (const waiter of [...waiters]) {
        waiter();
      }
    }

    socket.addEventListener("open", () => {
      clearTimeout(openTimeout);
      resolve({
        send(payload: unknown) {
          socket.send(JSON.stringify(payload));
        },
        async waitFor<T extends SocketMessage>(
          predicate: (message: SocketMessage) => message is T,
          label: string,
        ): Promise<T> {
          const deadline = Date.now() + timeoutMs;

          while (true) {
            const error = messages.find(
              (message): message is Extract<SocketMessage, { type: "voice.error" }> =>
                message.type === "voice.error",
            );
            if (error) {
              throw new Error(`Worker returned voice.error: ${error.message}`);
            }

            const found = messages.find(predicate);
            if (found) {
              return found;
            }

            const remaining = deadline - Date.now();
            if (remaining <= 0) {
              throw new Error(`Timed out waiting for ${label}`);
            }

            await new Promise<void>((res) => {
              const timer = setTimeout(() => {
                waiters.delete(onNotify);
                res();
              }, Math.min(remaining, 100));

              const onNotify = () => {
                clearTimeout(timer);
                waiters.delete(onNotify);
                res();
              };

              waiters.add(onNotify);
            });
          }
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(String(event.data)) as SocketMessage);
        notify();
      } catch (error) {
        reject(error);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(openTimeout);
      reject(new Error(`WebSocket connection failed for ${url}`));
    });
  });
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.pathname}: ${text}`);
  }

  return JSON.parse(text) as T;
}

function normalizeBaseUrl(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(message: string): void {
  console.log(`[smoke] ${message}`);
}

await main().catch((error) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
