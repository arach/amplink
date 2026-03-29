#!/usr/bin/env bun
// Relay entry point.
//
// Usage:
//   bun run src/relay/main.ts                    # defaults: port 7889
//   bun run src/relay/main.ts --port 9001

import { startRelay } from "./relay.ts";

const port = Number(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? 7889);

const relay = startRelay(port);

process.on("SIGINT", () => {
  console.log("\n[relay] shutting down...");
  relay.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  relay.stop();
  process.exit(0);
});
