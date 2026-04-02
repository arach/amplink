#!/usr/bin/env bun

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveConfig } from "./src/bridge/config.ts";
import type { TurnState } from "./src/bridge/state.ts";
import type {
  ControlSocketMessage,
  DesktopTaskMessage,
  DesktopTaskResultMessage,
  AmplinkEvent,
  Prompt,
  Session,
} from "./src/protocol/index.ts";
import {
  SecureTransport,
  generateKeyPair,
  type SocketLike,
} from "./src/security/index.ts";

interface DesktopListenerConfig {
  controlUrl: string;
  controlDisplayUrl: string;
  controlWorkerHost: string;
  bridgeUrl: string;
  bridgeSecure: boolean;
  reconnectMs: number;
  rpcTimeoutMs: number;
  taskTimeoutMs: number;
  desktopId?: string;
}

interface BridgeWireMessage {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
  seq?: number;
  event?: AmplinkEvent;
}

interface BridgeSessionResolution {
  session: Session;
  created: boolean;
}

interface BridgeSyncStatus {
  currentSeq: number;
}

interface SequencedBridgeEvent {
  seq: number;
  event: AmplinkEvent;
}

const DEFAULT_CONTROL_URL = "wss://amplink-control.myworker.dev/listen?token=TEST_TOKEN";
const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:7888";
const DEFAULT_RECONNECT_MS = 3_000;
const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_ENV_FILE = ".env.local";
const DEFAULT_BRIDGE_SECURE = resolveConfig().secure ?? false;

export function getDesktopListenerConfig(
  env: NodeJS.ProcessEnv = process.env,
): DesktopListenerConfig {
  const explicitControlUrl = env.AMPLINK_CONTROL_URL?.trim();
  const token = env.AMPLINK_DESKTOP_LISTENER_TOKEN?.trim();
  const controlBaseUrl = env.AMPLINK_CONTROL_BASE_URL?.trim() || "wss://amplink.arach.workers.dev";
  const controlUrl = explicitControlUrl || buildControlUrl(controlBaseUrl, token) || DEFAULT_CONTROL_URL;
  const controlDisplayUrl = redactControlUrl(controlUrl);
  const controlWorkerHost = getUrlHost(controlUrl) || "unknown";

  return {
    controlUrl,
    controlDisplayUrl,
    controlWorkerHost,
    bridgeUrl: env.AMPLINK_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL,
    bridgeSecure: readBoolean(env.AMPLINK_BRIDGE_SECURE, DEFAULT_BRIDGE_SECURE),
    reconnectMs: readPositiveInt(env.AMPLINK_LISTENER_RECONNECT_MS, DEFAULT_RECONNECT_MS),
    rpcTimeoutMs: readPositiveInt(env.AMPLINK_LISTENER_RPC_TIMEOUT_MS, DEFAULT_RPC_TIMEOUT_MS),
    taskTimeoutMs: readPositiveInt(env.AMPLINK_LISTENER_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS),
    desktopId: env.AMPLINK_DESKTOP_ID?.trim() || undefined,
  };
}

export function pickExistingBridgeSession(
  sessions: Session[],
  task: DesktopTaskMessage,
): Session | null {
  const explicitIds = [
    task.targetSessionId,
    task.target?.sessionId,
    task.prompt.sessionId,
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const sessionId of explicitIds) {
    const match = sessions.find((session) => session.id === sessionId);
    if (match) {
      return match;
    }
  }

  if (sessions.length === 1) {
    return sessions[0] ?? null;
  }

  return null;
}

export function buildBridgePrompt(
  task: DesktopTaskMessage,
  desktopSessionId: string,
): Prompt {
  return {
    sessionId: desktopSessionId,
    text: task.prompt.text,
    files: task.prompt.files,
    images: task.prompt.images,
    providerOptions: {
      ...task.prompt.providerOptions,
      source: "cloudflare-voice",
      voiceSessionId: task.sessionId,
      voiceUserId: task.userId,
      voiceQuickReply: task.quickReply,
      voiceIntent: task.intent.intent,
      voiceConfidence: task.intent.confidence,
      voiceRequestedAt: task.requestedAt,
      voiceHistoryLength: task.history.length,
      bridgeDispatch: true,
      desktopTaskId: task.taskId,
    },
  };
}

export function extractTurnResult(turn: TurnState): string {
  const textBlocks = turn.blocks
    .map((blockState) => blockState.block)
    .filter(
      (block): block is Extract<TurnState["blocks"][number]["block"], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.trim())
    .filter(Boolean);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n\n");
  }

  const actionOutput = turn.blocks
    .map((blockState) => blockState.block)
    .filter(
      (block): block is Extract<TurnState["blocks"][number]["block"], { type: "action" }> =>
        block.type === "action",
    )
    .map((block) => block.action.output.trim())
    .find(Boolean);
  if (actionOutput) {
    return actionOutput;
  }

  const errorOutput = turn.blocks
    .map((blockState) => blockState.block)
    .filter(
      (block): block is Extract<TurnState["blocks"][number]["block"], { type: "error" }> =>
        block.type === "error",
    )
    .map((block) => block.message.trim())
    .find(Boolean);
  if (errorOutput) {
    return errorOutput;
  }

  return `Turn ${turn.id} finished with status ${turn.status}.`;
}

export function startDesktopListener(
  config: DesktopListenerConfig = getDesktopListenerConfig(),
): { stop: () => void } {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let taskQueue = Promise.resolve();

  const clearSocketTimers = (): void => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, config.reconnectMs);
  };

  const connect = (): void => {
    if (stopped) {
      return;
    }

    console.log(`[desktop-listener] connecting to ${config.controlDisplayUrl}`);
    socket = new WebSocket(config.controlUrl);

    socket.addEventListener("open", () => {
      console.log("[desktop-listener] control socket connected", {
        workerHost: config.controlWorkerHost,
      });
      socket?.send(
        JSON.stringify({
          type: "listener.hello",
          connectedAt: new Date().toISOString(),
          bridgeUrl: config.bridgeUrl,
          desktopId: config.desktopId,
        } satisfies ControlSocketMessage),
      );

      pingInterval = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "ping",
            at: new Date().toISOString(),
          } satisfies ControlSocketMessage));
        }
      }, 25_000);
    });

    socket.addEventListener("message", (event) => {
      void (async () => {
        const payload = safeParse<ControlSocketMessage>(await readSocketMessage(event.data));
        if (!payload) {
          console.warn("[desktop-listener] ignoring non-JSON control message");
          return;
        }

        if (payload.type === "listener.ready") {
          console.log(`[desktop-listener] listener ready at ${payload.connectedAt}`);
          return;
        }

        if (payload.type === "pong") {
          return;
        }

        if (payload.type !== "task") {
          console.log("[desktop-listener] ignoring unsupported control message", {
            type: payload.type,
          });
          return;
        }

        taskQueue = taskQueue
          .catch(() => {
            // Keep the queue alive after a failed task.
          })
          .then(async () => {
            console.log("[desktop-listener] task received", {
              taskId: payload.taskId,
              sessionId: payload.sessionId,
              intent: payload.intent.intent,
              shouldDispatch: payload.intent.shouldDispatch,
            });
            const result = await runDesktopTask(payload, config);
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(result));
            } else {
              console.error("[desktop-listener] result ready but control socket is closed");
            }
          });
      })();
    });

    socket.addEventListener("close", (event) => {
      clearSocketTimers();
      console.warn("[desktop-listener] control socket closed", {
        code: event.code,
        reason: event.reason,
      });
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      console.error("[desktop-listener] control socket error");
      socket?.close();
    });
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearSocketTimers();
      socket?.close(1000, "desktop listener stopped");
    },
  };
}

export async function runDesktopTask(
  task: DesktopTaskMessage,
  config: Pick<DesktopListenerConfig, "bridgeUrl" | "bridgeSecure" | "rpcTimeoutMs" | "taskTimeoutMs">,
): Promise<DesktopTaskResultMessage> {
  const startedAt = Date.now();
  try {
    const client = await BridgeRpcClient.connect(
      config.bridgeUrl,
      config.rpcTimeoutMs,
      config.bridgeSecure,
    );
    try {
      const target = await resolveBridgeSession(client, task);
      console.log("[desktop-listener] dispatching into bridge", {
        taskId: task.taskId,
        voiceSessionId: task.sessionId,
        desktopSessionId: target.session.id,
        createdSession: target.created,
      });
      const syncStatus = await client.rpc<BridgeSyncStatus>("sync/status");

      await client.rpc("prompt/send", buildBridgePrompt(task, target.session.id));

      const turnId = await client.waitForTurnCompletion(
        target.session.id,
        syncStatus.currentSeq,
        config.taskTimeoutMs,
      );
      const completedTurn = await client.rpc<TurnState>("session/turn", {
        sessionId: target.session.id,
        turnId,
      });

      const resultText = extractTurnResult(completedTurn);
      const status = completedTurn.status === "completed" ? "done" : "error";

      console.log("[desktop-listener] task completed", {
        taskId: task.taskId,
        voiceSessionId: task.sessionId,
        desktopSessionId: target.session.id,
        status,
        durationMs: Date.now() - startedAt,
      });

      return {
        type: "task.result",
        taskId: task.taskId,
        sessionId: task.sessionId,
        result: resultText,
        status,
        completedAt: new Date().toISOString(),
        error: status === "error" ? resultText : undefined,
      };
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[desktop-listener] task failed", {
      taskId: task.taskId,
      sessionId: task.sessionId,
      durationMs: Date.now() - startedAt,
      error: message,
    });

    return {
      type: "task.result",
      taskId: task.taskId,
      sessionId: task.sessionId,
      result: message,
      status: "error",
      completedAt: new Date().toISOString(),
      error: message,
    };
  }
}

async function resolveBridgeSession(
  client: BridgeRpcClient,
  task: DesktopTaskMessage,
): Promise<BridgeSessionResolution> {
  const sessions = await client.rpc<Session[]>("session/list");
  const existing = pickExistingBridgeSession(sessions, task);
  if (existing) {
    return { session: existing, created: false };
  }

  if (task.target?.adapterType) {
    const created = await client.rpc<Session>("session/create", {
      adapterType: task.target.adapterType,
      name: task.target.name ?? `Voice task ${task.requestedAt}`,
      cwd: task.target.cwd,
      options: task.target.options,
    });
    return { session: created, created: true };
  }

  throw new Error(
    "No active Amplink bridge session is available. Keep exactly one session open or include an explicit target session.",
  );
}

class BridgeRpcClient {
  private messages: BridgeWireMessage[] = [];
  private waiters = new Set<() => void>();
  private closed = false;
  private transportError: Error | null = null;

  private constructor(
    private readonly ws: WebSocket,
    private readonly rpcTimeoutMs: number,
    private readonly sendMessage: (payload: string) => void,
  ) {}

  static connect(
    url: string,
    rpcTimeoutMs: number,
    secure = false,
  ): Promise<BridgeRpcClient> {
    return secure
      ? BridgeRpcClient.connectSecure(url, rpcTimeoutMs)
      : BridgeRpcClient.connectPlain(url, rpcTimeoutMs);
  }

  private static connectPlain(
    url: string,
    rpcTimeoutMs: number,
  ): Promise<BridgeRpcClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new BridgeRpcClient(ws, rpcTimeoutMs, (payload) => {
        ws.send(payload);
      });

      ws.addEventListener("message", (event) => {
        void (async () => {
          client.pushMessage(await readSocketMessage(event.data));
        })();
      });

      ws.addEventListener("open", () => resolve(client));
      ws.addEventListener("close", () => {
        client.closed = true;
        client.notifyWaiters();
      });
      ws.addEventListener("error", () => {
        reject(new Error(`Failed to connect to bridge at ${url}`));
      });
    });
  }

  private static connectSecure(
    url: string,
    rpcTimeoutMs: number,
  ): Promise<BridgeRpcClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      const client = new BridgeRpcClient(ws, rpcTimeoutMs, (payload) => {
        transport.send(payload);
      });
      const clientKey = generateKeyPair();
      let transport!: SecureTransport;
      let ready = false;

      ws.addEventListener("message", (event) => {
        if (!transport) {
          return;
        }

        const data =
          typeof event.data === "string"
            ? event.data
            : new Uint8Array(event.data as ArrayBuffer);
        transport.receive(data);
      });

      ws.addEventListener("open", () => {
        const socketAdapter: SocketLike = {
          send(data) {
            ws.send(data);
          },
        };

        transport = new SecureTransport(
          socketAdapter,
          "initiator",
          clientKey,
          {
            onReady: () => {
              ready = true;
              resolve(client);
            },
            onMessage: (message) => {
              client.pushMessage(message);
            },
            onError: (error) => {
              client.transportError = error;
              client.notifyWaiters();
              if (!ready) {
                reject(error);
              }
            },
            onClose: () => {
              client.closed = true;
              client.notifyWaiters();
            },
          },
          { pattern: "XX" },
        );
      });

      ws.addEventListener("close", () => {
        client.closed = true;
        client.notifyWaiters();
      });

      ws.addEventListener("error", () => {
        if (!ready) {
          reject(new Error(`Failed to connect to bridge at ${url}`));
        }
      });
    });
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }

  async rpc<T>(method: string, params?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    this.sendMessage(JSON.stringify({ id, method, params }));
    const response = await this.waitForMessage((message) => message.id === id, this.rpcTimeoutMs);
    if (response.error) {
      throw new Error(`[bridge] ${method} failed: ${response.error.message}`);
    }

    return response.result as T;
  }

  async waitForEvent(
    predicate: (events: AmplinkEvent[]) => boolean,
    timeoutMs: number,
  ): Promise<AmplinkEvent[]> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const events = this.messages
        .filter((message): message is BridgeWireMessage & { event: AmplinkEvent } => Boolean(message.event))
        .map((message) => message.event);

      if (predicate(events)) {
        return events;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for the Amplink bridge turn to finish.");
      }

      await this.waitForNotification(Math.min(remaining, 50));
      if (this.transportError) {
        throw this.transportError;
      }
      if (this.closed) {
        throw new Error("Bridge socket closed while waiting for task completion.");
      }
    }
  }

  async waitForTurnCompletion(
    sessionId: string,
    afterSeq: number,
    timeoutMs: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const events = this.messages
        .filter(
          (message): message is BridgeWireMessage & SequencedBridgeEvent =>
            typeof message.seq === "number" && Boolean(message.event),
        )
        .filter(
          (message) =>
            message.seq > afterSeq &&
            "sessionId" in message.event &&
            message.event.sessionId === sessionId,
        );

      const turnId = findCompletedTurnId(events);
      if (turnId) {
        return turnId;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for the Amplink bridge turn to finish.");
      }

      await this.waitForNotification(Math.min(remaining, 50));
      if (this.transportError) {
        throw this.transportError;
      }
      if (this.closed) {
        throw new Error("Bridge socket closed while waiting for task completion.");
      }
    }
  }

  private async waitForMessage(
    predicate: (message: BridgeWireMessage) => boolean,
    timeoutMs: number,
  ): Promise<BridgeWireMessage> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const found = this.messages.find(predicate);
      if (found) {
        return found;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for bridge RPC response.");
      }

      await this.waitForNotification(Math.min(remaining, 50));
      if (this.transportError) {
        throw this.transportError;
      }
      if (this.closed) {
        throw new Error("Bridge socket closed before the RPC response arrived.");
      }
    }
  }

  private pushMessage(raw: string): void {
    const payload = safeParse<BridgeWireMessage>(raw);
    if (!payload) {
      return;
    }

    this.messages.push(payload);
    this.notifyWaiters();
  }

  private async waitForNotification(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const waiter = (): void => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };

      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve();
      }, timeoutMs);

      this.waiters.add(waiter);
    });
  }

  private notifyWaiters(): void {
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }
}

export function findCompletedTurnId(
  events: SequencedBridgeEvent[],
): string | null {
  let currentTurnId: string | null = null;

  for (const { event } of events) {
    if (event.event === "turn:start") {
      currentTurnId = event.turn.id;
      continue;
    }

    if (
      currentTurnId &&
      event.event === "turn:end" &&
      event.turnId === currentTurnId
    ) {
      return currentTurnId;
    }
  }

  return null;
}

async function readSocketMessage(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Blob) {
    return await data.text();
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  return String(data);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function loadDesktopListenerEnvFile(
  filePath = resolve(process.cwd(), DEFAULT_ENV_FILE),
  targetEnv: NodeJS.ProcessEnv = process.env,
): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }

    if (targetEnv[entry.key] === undefined) {
      targetEnv[entry.key] = entry.value;
    }
  }
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const withoutExport = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const separator = withoutExport.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const key = withoutExport.slice(0, separator).trim();
  const rawValue = withoutExport.slice(separator + 1).trim();
  if (!key) {
    return null;
  }

  return {
    key,
    value: stripWrappingQuotes(rawValue),
  };
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function buildControlUrl(baseUrl: string, token: string | undefined): string | null {
  if (!token) {
    return null;
  }

  const url = new URL(baseUrl);
  url.pathname = "/listen";
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function redactControlUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }
    return url.toString();
  } catch {
    return value.replace(/token=[^&]+/g, "token=[redacted]");
  }
}

function getUrlHost(value: string): string | null {
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  loadDesktopListenerEnvFile();
  const config = getDesktopListenerConfig();
  console.log("[desktop-listener] starting", {
    controlUrl: config.controlDisplayUrl,
    workerHost: config.controlWorkerHost,
    bridgeUrl: config.bridgeUrl,
    reconnectMs: config.reconnectMs,
  });

  const listener = startDesktopListener(config);
  const shutdown = (): void => listener.stop();

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  await main();
}
