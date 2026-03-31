// OpenCode adapter — persistent process with JSON event streaming.
//
// Spawns `opencode run --format json` for each turn. Between turns, uses
// `--continue` or `--session <id>` to maintain conversation continuity.
//
// OpenCode JSON events:
//   step_start    → turn phase begins (may have multiple steps per turn)
//   text          → text content block
//   tool_use      → tool call with input/output/state
//   thinking      → reasoning content
//   step_finish   → turn phase ends (with reason, tokens, cost)
//
// OpenCode also supports `opencode serve` (WebSocket server) and
// `opencode attach` (connect to running server) for richer integration.
// This adapter uses the CLI approach for simplicity and faithful harness:
// the project's .opencode config, plugins, MCP servers, and LSP all load
// naturally from cwd.

import { BaseAdapter } from "../protocol/adapter.ts";
import type { AdapterConfig } from "../protocol/adapter.ts";
import type {
  Action,
  Block,
  BlockStatus,
  Prompt,
  Turn,
  TurnStatus,
} from "../protocol/primitives.ts";
import type { Subprocess } from "bun";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenCodeAdapter extends BaseAdapter {
  readonly type = "opencode";

  private process: Subprocess | null = null;
  private currentTurn: Turn | null = null;
  private blockIndex = 0;
  private lastSessionId: string | null = null;

  // Track blocks by part ID for delta correlation.
  private blockByPartId = new Map<string, Block>();
  private currentTextBlock: Block | null = null;

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    // Each prompt spawns opencode run with JSON output.
    // Multi-turn continuity via --session or --continue.
    const args = ["run", "--format", "json"];

    // Model override.
    const model = this.config.options?.["model"] as string | undefined;
    if (model) args.push("--model", model);

    // Agent override.
    const agent = this.config.options?.["agent"] as string | undefined;
    if (agent) args.push("--agent", agent);

    // Thinking output.
    args.push("--thinking");

    // Session continuity.
    if (this.lastSessionId) {
      args.push("--session", this.lastSessionId);
    } else {
      const resume = this.config.options?.["resume"] as boolean | undefined;
      if (resume) args.push("--continue");

      const sessionId = this.config.options?.["session"] as string | undefined;
      if (sessionId) args.push("--session", sessionId);
    }

    // File attachments.
    if (prompt.files?.length) {
      for (const f of prompt.files) {
        args.push("--file", f);
      }
    }

    // The message.
    args.push(prompt.text);

    this.blockIndex = 0;
    this.blockByPartId.clear();
    this.currentTextBlock = null;

    const turn: Turn = {
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date().toISOString(),
      blocks: [],
    };
    this.currentTurn = turn;
    this.emit("event", { event: "turn:start", sessionId: this.session.id, turn });

    this.process = Bun.spawn(["opencode", ...args], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    this.readStream(turn);

    this.process.exited.then((code) => {
      if (code !== 0 && turn.status === "started") {
        this.emitError(turn, `opencode exited with code ${code}`);
        this.endTurn(turn, "failed");
      }
    });
  }

  interrupt(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
    }
    if (this.currentTurn) {
      this.endTurn(this.currentTurn, "stopped");
    }
  }

  async shutdown(): Promise<void> {
    this.interrupt();
    this.setStatus("closed");
  }

  // ---------------------------------------------------------------------------
  // Stream reader
  // ---------------------------------------------------------------------------

  private async readStream(turn: Turn): Promise<void> {
    const stdout = this.process?.stdout;
    if (!stdout || typeof stdout === "number") return;

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            this.handleEvent(turn, JSON.parse(trimmed));
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* stream closed */ }

    // Close any open blocks and end the turn.
    this.closeOpenBlocks(turn);
    if (turn.status !== "stopped" && turn.status !== "failed") {
      this.endTurn(turn, "completed");
    }
  }

  // ---------------------------------------------------------------------------
  // Event router — OpenCode JSON events → Plexus primitives
  // ---------------------------------------------------------------------------

  private handleEvent(turn: Turn, event: any): void {
    // Capture session ID for continuity.
    if (event.sessionID && !this.lastSessionId) {
      this.lastSessionId = event.sessionID;
      // Update session model from first event if available.
      if (event.part?.model) {
        (this.session as any).model = event.part.model;
      }
    }

    switch (event.type) {
      case "text": {
        this.handleText(turn, event);
        break;
      }

      case "thinking": {
        this.handleThinking(turn, event);
        break;
      }

      case "tool_use": {
        this.handleToolUse(turn, event);
        break;
      }

      case "step_start": {
        // A new step — could be multi-step within one turn.
        // We don't create a new Plexus turn for each step; they're
        // part of the same turn.
        break;
      }

      case "step_finish": {
        // Step done. Close any open text blocks between steps.
        if (this.currentTextBlock) {
          this.emitBlockEnd(turn, this.currentTextBlock, "completed");
          this.currentTextBlock = null;
        }
        break;
      }

      case "error": {
        this.emitError(turn, event.error ?? event.message ?? "Unknown error");
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleText(turn: Turn, event: any): void {
    const text = event.part?.text ?? "";
    const partId = event.part?.id;

    // Each text event is a complete text block in opencode's model.
    const block = this.startBlock(turn, {
      type: "text",
      text,
      status: "completed",
    });

    if (partId) this.blockByPartId.set(partId, block);
    this.emitBlockEnd(turn, block, "completed");
  }

  private handleThinking(turn: Turn, event: any): void {
    const text = event.part?.text ?? "";

    const block = this.startBlock(turn, {
      type: "reasoning",
      text,
      status: "completed",
    });
    this.emitBlockEnd(turn, block, "completed");
  }

  private handleToolUse(turn: Turn, event: any): void {
    const part = event.part ?? {};
    const toolName: string = part.tool ?? "unknown";
    const callId: string = part.callID ?? crypto.randomUUID();
    const state = part.state ?? {};
    const input = state.input ?? {};
    const output: string = state.output ?? "";
    const toolStatus = state.status ?? "completed";

    let action: Action;

    if (toolName === "edit" || toolName === "write" || toolName === "multi_edit") {
      action = {
        kind: "file_change",
        path: input.filePath ?? input.file_path ?? input.path ?? "",
        diff: output,
        status: toolStatus === "error" ? "failed" : "completed",
        output,
      };
    } else if (toolName === "bash") {
      action = {
        kind: "command",
        command: input.command ?? "",
        exitCode: state.metadata?.exitCode,
        status: toolStatus === "error" ? "failed" : "completed",
        output,
      };
    } else if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") {
      action = {
        kind: "tool_call",
        toolName,
        toolCallId: callId,
        input,
        result: output,
        status: toolStatus === "error" ? "failed" : "completed",
        output: typeof output === "string" ? output.slice(0, 500) : "",
      };
    } else {
      action = {
        kind: "tool_call",
        toolName,
        toolCallId: callId,
        input,
        status: toolStatus === "error" ? "failed" : "completed",
        output,
      };
    }

    const block = this.startBlock(turn, {
      type: "action",
      action,
      status: "completed",
    });

    if (output) {
      this.emit("event", {
        event: "block:action:output",
        sessionId: this.session.id,
        turnId: turn.id,
        blockId: block.id,
        output,
      });
    }

    this.emitBlockEnd(turn, block, toolStatus === "error" ? "failed" : "completed");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private closeOpenBlocks(turn: Turn): void {
    if (this.currentTextBlock) {
      this.emitBlockEnd(turn, this.currentTextBlock, "completed");
      this.currentTextBlock = null;
    }
    this.blockByPartId.clear();
  }

  private startBlock(turn: Turn, partial: Record<string, unknown> & { type: string; status: BlockStatus }): Block {
    const block: Block = {
      ...partial,
      id: crypto.randomUUID(),
      turnId: turn.id,
      index: this.blockIndex++,
    } as Block;

    turn.blocks.push(block);

    this.emit("event", {
      event: "block:start",
      sessionId: this.session.id,
      turnId: turn.id,
      block,
    });

    return block;
  }

  private emitBlockEnd(turn: Turn, block: Block, status: BlockStatus): void {
    this.emit("event", {
      event: "block:end",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      status,
    });
  }

  private emitError(turn: Turn, message: string): void {
    const block = this.startBlock(turn, {
      type: "error",
      message,
      status: "completed",
    });
    this.emitBlockEnd(turn, block, "completed");
  }

  private endTurn(turn: Turn, status: TurnStatus): void {
    turn.status = status;
    turn.endedAt = new Date().toISOString();
    this.currentTurn = null;
    this.emit("event", {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turn.id,
      status,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory export
// ---------------------------------------------------------------------------

export const createAdapter = (config: AdapterConfig) => new OpenCodeAdapter(config);
