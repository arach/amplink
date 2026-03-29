// Claude Code adapter — reference Plexus adapter implementation.
//
// Spawns `claude` in a streaming mode, reads its JSON output, and maps
// everything to Plexus primitives.  Demonstrates the full adapter lifecycle:
// start → session active → send prompt → turn/block deltas → turn end.
//
// Claude Code supports `--output-format stream-json` which emits one JSON
// object per line to stdout, covering messages, tool use, results, and
// system events.

import { BaseAdapter } from "../protocol/adapter.ts";
import type { AdapterConfig } from "../protocol/adapter.ts";
import type {
  Action,
  Block,
  BlockStatus,
  PlexusEvent,
  Prompt,
  Turn,
  TurnStatus,
} from "../protocol/primitives.ts";
import type { Subprocess } from "bun";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type = "claude-code";

  private process: Subprocess | null = null;
  private currentTurn: Turn | null = null;
  private blockIndex = 0;
  private abortController: AbortController | null = null;

  constructor(config: AdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    this.setStatus("active");
  }

  send(prompt: Prompt): void {
    // Each prompt spawns a new claude process in streaming JSON mode.
    // Claude Code outputs one JSON event per line to stdout.
    const args = [
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", "50",
      "-p", prompt.text,
    ];

    // Add file mentions as context.
    if (prompt.files?.length) {
      for (const f of prompt.files) {
        args.push("--file", f);
      }
    }

    const model = this.config.options?.["model"] as string | undefined;
    if (model) {
      args.push("--model", model);
    }

    this.abortController = new AbortController();
    this.blockIndex = 0;

    const turn: Turn = {
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date().toISOString(),
      blocks: [],
    };
    this.currentTurn = turn;
    this.emit("event", { event: "turn:start", sessionId: this.session.id, turn });

    this.process = Bun.spawn(["claude", ...args], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdout: "pipe",
      stderr: "pipe",
      signal: this.abortController.signal,
    });

    this.readStream(turn);
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
  // Stream reader — parses Claude Code's stream-json output line by line
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
            const event = JSON.parse(trimmed);
            this.handleClaudeEvent(turn, event);
          } catch {
            // Skip malformed lines.
          }
        }
      }

      // Process remaining buffer.
      if (buffer.trim()) {
        try {
          this.handleClaudeEvent(turn, JSON.parse(buffer.trim()));
        } catch { /* skip */ }
      }

      // If we get here without an explicit turn end, mark completed.
      if (turn.status !== "stopped" && turn.status !== "failed") {
        this.endTurn(turn, "completed");
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        this.endTurn(turn, "stopped");
      } else {
        this.emitError(turn, err.message ?? "Stream read error");
        this.endTurn(turn, "failed");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event mapping — Claude Code stream-json events → Plexus primitives
  //
  // Claude Code stream-json events include:
  //   { type: "system", ... }         — system init info
  //   { type: "assistant", ... }      — assistant text (message.content blocks)
  //   { type: "tool_use", ... }       — tool invocation
  //   { type: "tool_result", ... }    — tool output
  //   { type: "result", ... }         — final result summary
  //   { type: "error", ... }          — error
  // ---------------------------------------------------------------------------

  private handleClaudeEvent(turn: Turn, event: any): void {
    switch (event.type) {
      case "assistant": {
        this.handleAssistantEvent(turn, event);
        break;
      }

      case "tool_use": {
        this.handleToolUseEvent(turn, event);
        break;
      }

      case "tool_result": {
        this.handleToolResultEvent(turn, event);
        break;
      }

      case "result": {
        // Final summary — the same text was already emitted via "assistant"
        // events during streaming. Skip creating a duplicate text block.
        // The turn will be ended by the readStream() method after the
        // stream closes.
        break;
      }

      case "error": {
        this.emitError(turn, event.error?.message ?? event.message ?? "Unknown error");
        break;
      }
    }
  }

  private handleAssistantEvent(turn: Turn, event: any): void {
    // Assistant events contain message.content array with text and thinking blocks.
    const content = event.message?.content ?? event.content;
    if (!Array.isArray(content)) return;

    for (const part of content) {
      if (part.type === "thinking" || part.type === "reasoning") {
        const block = this.startBlock(turn, {
          type: "reasoning",
          text: part.thinking ?? part.text ?? "",
          status: "completed",
        });
        this.emitBlockEnd(turn, block, "completed");
      } else if (part.type === "text") {
        const block = this.startBlock(turn, {
          type: "text",
          text: part.text ?? "",
          status: "completed",
        });
        this.emitBlockEnd(turn, block, "completed");
      }
    }
  }

  private handleToolUseEvent(turn: Turn, event: any): void {
    const toolName: string = event.tool_name ?? event.name ?? "unknown";
    const toolCallId: string = event.tool_use_id ?? event.id ?? crypto.randomUUID();

    // Map well-known Claude Code tools to specific action kinds.
    let action: Action;

    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
      action = {
        kind: "file_change",
        path: event.input?.file_path ?? event.input?.path ?? "",
        diff: "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Bash") {
      action = {
        kind: "command",
        command: event.input?.command ?? "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Agent") {
      action = {
        kind: "subagent",
        agentId: toolCallId,
        agentName: event.input?.description ?? undefined,
        prompt: event.input?.prompt ?? undefined,
        status: "running",
        output: "",
      };
    } else {
      action = {
        kind: "tool_call",
        toolName,
        toolCallId,
        input: event.input,
        status: "running",
        output: "",
      };
    }

    const block = this.startBlock(turn, {
      type: "action",
      action,
      status: "streaming",
    });

    // Stash the tool call ID → block ID mapping for result correlation.
    (turn as any).__toolBlockMap ??= new Map();
    (turn as any).__toolBlockMap.set(toolCallId, block.id);
  }

  private handleToolResultEvent(turn: Turn, event: any): void {
    const toolCallId: string = event.tool_use_id ?? event.id ?? "";
    const blockId: string = (turn as any).__toolBlockMap?.get(toolCallId);
    if (!blockId) return;

    const output = typeof event.content === "string"
      ? event.content
      : JSON.stringify(event.content ?? "");

    // Emit the output delta.
    this.emit("event", {
      event: "block:action:output",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId,
      output,
    });

    // Mark action completed.
    const status = event.is_error ? "failed" : "completed";
    this.emit("event", {
      event: "block:action:status",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId,
      status,
    });

    this.emit("event", {
      event: "block:end",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId,
      status: status === "failed" ? "failed" : "completed",
    });
  }

  // ---------------------------------------------------------------------------
  // Block helpers
  // ---------------------------------------------------------------------------

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
// Factory export — what the bridge uses to register this adapter
// ---------------------------------------------------------------------------

export const createAdapter = (config: AdapterConfig) => new ClaudeCodeAdapter(config);
