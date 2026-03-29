#!/usr/bin/env bun
// Bridge entry point.
//
// Usage:
//   bun run src/bridge/main.ts                    # defaults: port 7888
//   bun run src/bridge/main.ts --port 9000

import { Bridge } from "./bridge.ts";
import { startBridgeServer } from "./server.ts";
import { createAdapter as createClaudeCode } from "../adapters/claude-code.ts";

const port = Number(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? 7888);

const bridge = new Bridge({
  port,
  adapters: {
    "claude-code": createClaudeCode,
    // Register more adapters here as they're built:
    // "codex": createCodex,
    // "ollama": createOllama,
  },
});

const server = startBridgeServer(bridge, port);

// Graceful shutdown.
process.on("SIGINT", async () => {
  console.log("\n[bridge] shutting down...");
  await bridge.shutdown();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await bridge.shutdown();
  server.stop();
  process.exit(0);
});

console.log("[bridge] ready");
console.log("[bridge] registered adapters:", Object.keys(bridge["adapterFactories"]).join(", "));
