import type { Prompt } from "./primitives.ts";

export interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export type VoiceIntent = "command" | "question" | "status" | "intake" | "dictation";

export interface VoiceIntentResult {
  intent: VoiceIntent;
  reply: string;
  shouldDispatch: boolean;
  dispatchPrompt: string;
  confidence: number;
}

export interface DesktopRegistration {
  userId: string;
  endpoint: string;
  desktopId?: string;
  sessionId?: string;
  registeredAt: string;
}

export interface DispatchTarget {
  sessionId?: string;
  adapterType?: string;
  cwd?: string;
  name?: string;
  options?: Record<string, unknown>;
}

export interface DispatchPrompt extends Omit<Prompt, "sessionId"> {
  sessionId?: string;
}

export interface DesktopDispatchEnvelope {
  source: "cloudflare-voice";
  /** Voice-session identifier from Cloudflare. */
  sessionId: string;
  /** Explicit alias for the voice session, for newer receivers. */
  voiceSessionId?: string;
  userId: string;
  /** Prompt content to relay into a desktop Amplink session. */
  prompt: DispatchPrompt;
  /** Optional explicit desktop session or create-session hint. */
  target?: DispatchTarget;
  /** Optional direct target override. */
  targetSessionId?: string;
  quickReply: string;
  intent: VoiceIntentResult;
  history: ConversationEntry[];
  requestedAt: string;
}

export interface DesktopDispatchResult {
  queued: boolean;
  endpoint?: string;
  status?: number;
  skipped?: boolean;
  error?: string;
  route?: "none" | "control-websocket" | "http-endpoint";
  taskId?: string;
}

export interface DesktopTaskMessage {
  type: "task";
  taskId: string;
  sessionId: string;
  userId: string;
  prompt: DispatchPrompt;
  target?: DispatchTarget;
  targetSessionId?: string;
  quickReply: string;
  intent: VoiceIntentResult;
  history: ConversationEntry[];
  requestedAt: string;
}

export interface DesktopTaskResultMessage {
  type: "task.result";
  taskId: string;
  sessionId: string;
  result: unknown;
  status: "done" | "error";
  completedAt: string;
  error?: string;
}

export interface DesktopListenerHelloMessage {
  type: "listener.hello";
  connectedAt: string;
  bridgeUrl?: string;
  desktopId?: string;
}

export interface DesktopListenerReadyMessage {
  type: "listener.ready";
  connectedAt: string;
}

export interface ControlPingMessage {
  type: "ping";
  at?: string;
}

export interface ControlPongMessage {
  type: "pong";
  at: string;
}

export type ControlSocketMessage =
  | DesktopTaskMessage
  | DesktopTaskResultMessage
  | DesktopListenerHelloMessage
  | DesktopListenerReadyMessage
  | ControlPingMessage
  | ControlPongMessage;
