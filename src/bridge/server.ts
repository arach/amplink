// Bridge WebSocket server.
//
// Exposes the bridge over a local WebSocket so the relay (or a direct LAN
// connection from the phone) can send prompts and receive Plexus events.
//
// Supports two modes:
//   - Plaintext (default): backward-compatible, no encryption
//   - Secure: wraps each connection in a Noise-encrypted SecureTransport
//
// Wire protocol: newline-delimited JSON.
//   Inbound (phone -> bridge):  JSON-RPC requests
//   Outbound (bridge -> phone): Plexus events + JSON-RPC responses (wrapped as { seq, event })

import { readdirSync, realpathSync, statSync } from "fs";
import { basename, isAbsolute, join, relative } from "path";
import { homedir } from "os";
import type { Bridge } from "./bridge.ts";
import type { Prompt } from "../protocol/index.ts";
import { resolveConfig } from "./config.ts";
import {
  SecureTransport,
  type SocketLike,
  type KeyPair,
  isTrustedPeer,
  bytesToHex,
} from "../security/index.ts";
import type { ServerWebSocket } from "bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RPCRequest {
  id: string;
  method: string;
  params?: unknown;
}

interface RPCResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface BridgeServerOptions {
  /** Enable Noise encryption on all connections. Default: false. */
  secure?: boolean;
  /** Bridge's static key pair (required when secure=true). */
  identity?: KeyPair;
}

interface SocketState {
  unsub?: () => void;
  transport?: SecureTransport;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startBridgeServer(
  bridge: Bridge,
  port: number,
  options: BridgeServerOptions = {},
): { stop: () => void } {
  const { secure = false, identity } = options;

  if (secure && !identity) {
    throw new Error("[bridge] secure mode requires an identity (key pair)");
  }

  // Per-socket state, keyed by the raw ServerWebSocket reference.
  const socketState = new WeakMap<ServerWebSocket<unknown>, SocketState>();

  const server = Bun.serve({
    port,
    fetch(req, server) {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("Plexus bridge. Connect via WebSocket.", { status: 200 });
      }
    },
    websocket: {
      open(ws) {
        console.log("[bridge] client connected");

        const state: SocketState = {};
        socketState.set(ws, state);

        if (secure && identity) {
          // Wrap in SecureTransport. The bridge is always the responder —
          // the phone (or relay-forwarded phone) initiates the handshake.
          const socketAdapter: SocketLike = { send: (data) => ws.send(data) };

          const transport = new SecureTransport(
            socketAdapter,
            "responder",
            identity,
            {
              onReady: (remotePublicKey) => {
                const pubHex = bytesToHex(remotePublicKey);
                const trusted = isTrustedPeer(pubHex);
                console.log(
                  `[bridge] secure handshake complete (peer: ${pubHex.slice(0, 12)}..., trusted: ${trusted})`,
                );

                // Push existing sessions through the encrypted channel.
                for (const session of bridge.listSessions()) {
                  transport.send(JSON.stringify({
                    seq: 0,
                    event: { event: "session:update", session },
                  }));
                }

                // Subscribe to future events — forwarded encrypted with seq.
                state.unsub = bridge.onEvent((sequenced) => {
                  transport.send(JSON.stringify({
                    seq: sequenced.seq,
                    event: sequenced.event,
                  }));
                });
              },

              onMessage: (message) => {
                // Decrypted JSON-RPC message from the phone.
                let req: RPCRequest;
                try {
                  req = JSON.parse(message);
                } catch {
                  transport.send(
                    JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }),
                  );
                  return;
                }

                handleRPC(bridge, req).then((res) => {
                  transport.send(JSON.stringify(res));
                });
              },

              onError: (err) => {
                console.error("[bridge] secure transport error:", err.message);
              },

              onClose: () => {
                state.unsub?.();
              },
            },
          );

          state.transport = transport;
        } else {
          // Plaintext mode — push existing sessions with seq wrapper.
          for (const session of bridge.listSessions()) {
            ws.send(JSON.stringify({
              seq: 0,
              event: { event: "session:update", session },
            }));
          }

          // Subscribe to all future events, wrapped with seq.
          state.unsub = bridge.onEvent((sequenced) => {
            ws.send(JSON.stringify({
              seq: sequenced.seq,
              event: sequenced.event,
            }));
          });
        }
      },

      message(ws, raw) {
        const state = socketState.get(ws);

        if (secure && state?.transport) {
          // Feed raw bytes into the SecureTransport (handshake or encrypted data).
          const data = typeof raw === "string" ? raw : new Uint8Array(raw);
          state.transport.receive(data);
        } else {
          // Plaintext mode — handle JSON-RPC directly.
          const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
          let req: RPCRequest;
          try {
            req = JSON.parse(text);
          } catch {
            ws.send(JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }));
            return;
          }

          handleRPC(bridge, req).then((res) => {
            ws.send(JSON.stringify(res));
          });
        }
      },

      close(ws) {
        console.log("[bridge] client disconnected");
        const state = socketState.get(ws);
        state?.unsub?.();
      },
    },
  });

  const mode = secure ? "secure (Noise)" : "plaintext";
  console.log(`[bridge] listening on ws://localhost:${port} (${mode})`);

  return {
    stop() {
      server.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// RPC handler — also used by relay-client.ts for relayed connections
// ---------------------------------------------------------------------------

export async function handleRPC(bridge: Bridge, req: RPCRequest): Promise<RPCResponse> {
  try {
    switch (req.method) {
      case "session/create": {
        const p = req.params as { adapterType: string; name?: string; cwd?: string; options?: Record<string, unknown> };
        const session = await bridge.createSession(p.adapterType, {
          name: p.name,
          cwd: p.cwd,
          options: p.options,
        });
        return { id: req.id, result: session };
      }

      case "session/list": {
        return { id: req.id, result: bridge.listSessions() };
      }

      case "session/close": {
        const p = req.params as { sessionId: string };
        await bridge.closeSession(p.sessionId);
        return { id: req.id, result: { ok: true } };
      }

      case "prompt/send": {
        const prompt = req.params as Prompt;
        bridge.send(prompt);
        return { id: req.id, result: { ok: true } };
      }

      case "turn/interrupt": {
        const p = req.params as { sessionId: string };
        bridge.interrupt(p.sessionId);
        return { id: req.id, result: { ok: true } };
      }

      // -- Reconnect / buffer ------------------------------------------------

      case "sync/replay": {
        const p = req.params as { lastSeq: number };
        const events = bridge.replay(p.lastSeq);
        return { id: req.id, result: { events } };
      }

      case "sync/status": {
        return {
          id: req.id,
          result: {
            currentSeq: bridge.currentSeq(),
            oldestBufferedSeq: bridge.oldestBufferedSeq(),
            sessionCount: bridge.listSessions().length,
          },
        };
      }

      // -- Snapshot / status -------------------------------------------------

      case "session/snapshot": {
        const p = req.params as { sessionId: string };
        const snapshot = bridge.getSessionSnapshot(p.sessionId);
        if (!snapshot) {
          return { id: req.id, error: { code: -32001, message: `No session: ${p.sessionId}` } };
        }
        return { id: req.id, result: snapshot };
      }

      case "bridge/status": {
        const sessions = bridge.getSessionSummaries();
        return { id: req.id, result: { sessions } };
      }

      // -- Approval -----------------------------------------------------------

      case "action/decide": {
        const p = req.params as {
          sessionId: string;
          turnId: string;
          blockId: string;
          version: number;
          decision: "approve" | "deny";
          reason?: string;
        };

        // Look up the block's current approval state for version validation.
        const snapshot = bridge.getSessionSnapshot(p.sessionId);
        if (!snapshot) {
          return { id: req.id, error: { code: -32001, message: `No session: ${p.sessionId}` } };
        }

        const turn = snapshot.turns.find((t) => t.id === p.turnId);
        if (!turn) {
          return { id: req.id, error: { code: -32001, message: `No turn: ${p.turnId}` } };
        }

        const blockState = turn.blocks.find((b) => b.block.id === p.blockId);
        if (!blockState || blockState.block.type !== "action") {
          return { id: req.id, error: { code: -32001, message: `No action block: ${p.blockId}` } };
        }

        const action = (blockState.block as import("../protocol/index.ts").ActionBlock).action;
        if (!action.approval || action.approval.version !== p.version) {
          return { id: req.id, error: { code: -32010, message: "Stale approval version" } };
        }

        bridge.decide(p.sessionId, p.blockId, p.decision, p.reason);
        return { id: req.id, result: { ok: true } };
      }

      // -- Workspace discovery ------------------------------------------------

      case "workspace/info": {
        const config = resolveConfig();
        const configuredRoot = config.workspace?.root;
        if (!configuredRoot) {
          return { id: req.id, result: { configured: false } };
        }
        try {
          const root = resolveWorkspaceRoot(configuredRoot);
          return { id: req.id, result: { configured: true, root } };
        } catch (err: any) {
          return { id: req.id, error: { code: -32002, message: err.message } };
        }
      }

      case "workspace/list": {
        const config = resolveConfig();
        const configuredRoot = config.workspace?.root;
        if (!configuredRoot) {
          return { id: req.id, error: { code: -32002, message: "No workspace root configured" } };
        }

        const p = req.params as { path?: string } | undefined;

        try {
          const root = resolveWorkspaceRoot(configuredRoot);
          const browsePath = resolveWorkspacePath(root, p?.path);
          const entries = listDirectories(browsePath);
          return { id: req.id, result: { root, path: browsePath, entries } };
        } catch (err: any) {
          return { id: req.id, error: { code: -32000, message: err.message } };
        }
      }

      case "workspace/open": {
        const p = req.params as { path: string; adapter?: string; name?: string };
        const config = resolveConfig();
        const configuredRoot = config.workspace?.root;

        if (!configuredRoot) {
          return { id: req.id, error: { code: -32002, message: "No workspace root configured" } };
        }

        const root = resolveWorkspaceRoot(configuredRoot);
        const projectPath = resolveWorkspacePath(root, p.path);
        const stat = statSync(projectPath);
        if (!stat.isDirectory()) {
          return { id: req.id, error: { code: -32000, message: "Workspace target is not a directory" } };
        }

        const adapterType = p.adapter ?? "claude-code";
        const name = p.name ?? basename(projectPath);

        const session = await bridge.createSession(adapterType, {
          name,
          cwd: projectPath,
        });
        return { id: req.id, result: session };
      }

      default:
        return { id: req.id, error: { code: -32601, message: `Unknown method: ${req.method}` } };
    }
  } catch (err: any) {
    return { id: req.id, error: { code: -32000, message: err.message ?? "Internal error" } };
  }
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

interface DirectoryEntry {
  name: string;
  path: string;
  markers: string[];
}

function resolveWorkspaceRoot(root: string): string {
  const expandedRoot = root.replace(/^~/, homedir());
  return realpathSync(expandedRoot);
}

export function resolveWorkspacePath(root: string, requestedPath?: string): string {
  const normalizedRoot = resolveWorkspaceRoot(root);
  const expandedPath = requestedPath?.replace(/^~/, homedir());
  const candidate = expandedPath
    ? isAbsolute(expandedPath)
      ? expandedPath
      : join(normalizedRoot, expandedPath)
    : normalizedRoot;
  const resolvedCandidate = realpathSync(candidate);
  const rel = relative(normalizedRoot, resolvedCandidate);

  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return resolvedCandidate;
  }

  throw new Error("Path escapes workspace root");
}

const MARKER_FILES: [string, string][] = [
  [".git",            "git"],
  ["package.json",    "node"],
  ["Package.swift",   "swift"],
  ["Cargo.toml",      "rust"],
  ["go.mod",          "go"],
  ["pyproject.toml",  "python"],
  ["setup.py",        "python"],
  ["Gemfile",         "ruby"],
  ["build.gradle",    "java"],
  ["pom.xml",         "java"],
  ["CMakeLists.txt",  "cpp"],
  ["Makefile",        "make"],
  [".xcodeproj",      "xcode"],
];

function listDirectories(dirPath: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];

  for (const name of readdirSync(dirPath)) {
    if (name.startsWith(".")) continue;
    if (name === "node_modules" || name === ".build" || name === "target") continue;

    const fullPath = join(dirPath, name);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;

      const children = new Set(readdirSync(fullPath));
      const markers: string[] = [];
      const seen = new Set<string>();

      for (const [file, marker] of MARKER_FILES) {
        // Handle both exact matches and suffix matches (e.g. .xcodeproj)
        const found = file.startsWith(".")
          ? [...children].some(c => c.endsWith(file))
          : children.has(file);

        if (found && !seen.has(marker)) {
          markers.push(marker);
          seen.add(marker);
        }
      }

      entries.push({ name, path: fullPath, markers });
    } catch {
      continue;
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
