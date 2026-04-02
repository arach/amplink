#!/usr/bin/env bun
// Bridge entry point.
//
// Usage:
//   bun run bridge                                # defaults: port 17888, plaintext
//   bun run bridge -- --port 9000                 # custom port
//   bun run bridge -- --secure                    # enable Noise encryption on local WS
//   bun run bridge -- --relay ws://relay:7889     # connect outbound to relay
//   bun run bridge -- --pair                      # show QR code and wait for pairing
//   bun run bridge -- --relay ws://r:7889 --pair  # pair-only mode via relay
//
// Config file (~/.amplink/config.json) is loaded first, CLI flags override.

import { Bridge } from "./bridge.ts";
import { startBridgeServer } from "./server.ts";
import { startFileServer, type FileServer } from "./fileserver.ts";
import { connectToRelay } from "./relay-client.ts";
import { resolveConfig, CONFIG_FILE } from "./config.ts";
import { createAdapterRegistry } from "./adapters.ts";
import { printQRCode } from "./qr.ts";
import { loadOrCreateIdentity, bytesToHex } from "../security/index.ts";
import { log } from "./log.ts";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

loadEnvFile();
const config = resolveConfig();
const effectiveRelay = resolveRelayUrl(config.relay);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const identity = loadOrCreateIdentity();

// ---------------------------------------------------------------------------
// Adapter registry — hardcoded + config-driven
// ---------------------------------------------------------------------------

const adapters = createAdapterRegistry(config.adapters);

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const bridge = new Bridge({
  port: config.port,
  adapters,
});

// ---------------------------------------------------------------------------
// Local WebSocket server (always runs)
// ---------------------------------------------------------------------------

const server = startBridgeServer(bridge, config.port, {
  secure: config.secure,
  identity: config.secure ? identity : undefined,
});

// ---------------------------------------------------------------------------
// Outbound relay connection (optional)
// ---------------------------------------------------------------------------

let relayConnection: ReturnType<typeof connectToRelay> | null = null;

if (effectiveRelay) {
  relayConnection = connectToRelay(effectiveRelay, identity, bridge, {
    secure: true, // Relay connections are always encrypted.
    cloudflareBaseUrl: resolveCloudflareBaseUrl(),
  });

  // Show the QR code prominently in the terminal.
  printQRCode(relayConnection.qrPayload);
}

// ---------------------------------------------------------------------------
// File server (independent HTTP — survives independently of bridge/relay)
// ---------------------------------------------------------------------------

const fileServer = startFileServer({ port: config.port + 2 });

// ---------------------------------------------------------------------------
// Pair-only mode: if --pair is set without --relay, we can't pair (need relay).
// If --pair + --relay, we've already shown the QR — just keep the process alive.
// ---------------------------------------------------------------------------

if (config.pair && !effectiveRelay) {
  console.error("[bridge] --pair requires --relay <url> to generate a QR code");
  process.exit(1);
}

if (config.pair) {
  console.log("[bridge] pair mode — waiting for phone to scan QR code...");
  console.log("[bridge] press Ctrl+C to exit");
} else {
  printBanner();
}

// ---------------------------------------------------------------------------
// Auto-start sessions from config
// ---------------------------------------------------------------------------

if (!config.pair && config.sessions?.length) {
  console.log(`[bridge] auto-starting ${config.sessions.length} session(s)...`);
  for (const entry of config.sessions) {
    bridge.createSession(entry.adapter, {
      name: entry.name,
      cwd: entry.cwd?.replace(/^~/, homedir()),
      options: entry.options,
    }).then((session) => {
      console.log(`[bridge] session started: ${session.name} (${entry.adapter})`);
    }).catch((err) => {
      console.error(`[bridge] failed to start session "${entry.name}": ${err.message}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

function printBanner(): void {
  const idHex = bytesToHex(identity.publicKey).slice(0, 16);
  const mode = effectiveRelay ? "local + relay" : "local";
  const encryption = config.secure ? "Noise (local)" : "plaintext (local)";
  const adapterNames = Object.keys(adapters);

  console.log("");
  console.log("  amplink bridge");
  console.log("  ─────────────────────────────────");
  console.log(`  identity : ${idHex}...`);
  console.log(`  port     : ${config.port}`);
  console.log(`  mode     : ${mode}`);
  console.log(`  encrypt  : ${encryption}${effectiveRelay ? " + Noise (relay)" : ""}`);
  console.log(`  adapters : ${adapterNames.join(", ")}`);
  console.log(`  files    : http://localhost:${config.port + 2}/`);
  console.log(`  dispatch : http://localhost:${config.port}/dispatch`);
  console.log(`  log      : ${log.path}`);
  if (effectiveRelay) {
    console.log(`  relay    : ${effectiveRelay}`);
  }
  console.log("  ─────────────────────────────────");
  console.log("");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  console.log("\n[bridge] shutting down...");
  fileServer.stop();
  relayConnection?.disconnect();
  await bridge.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function resolveCloudflareBaseUrl(): string {
  const explicit = process.env.AMPLINK_CLOUDFLARE_WORKER_URL?.trim();
  return explicit && explicit.length > 0
    ? explicit
    : "https://amplink.arach.workers.dev";
}

function resolveRelayUrl(configRelay?: string): string | undefined {
  if (hasCliRelayOverride()) {
    return configRelay;
  }

  const explicit = process.env.AMPLINK_BRIDGE_RELAY_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const workerUrl = process.env.AMPLINK_CLOUDFLARE_WORKER_URL?.trim();
  if (!workerUrl) {
    return configRelay;
  }

  try {
    const url = new URL(workerUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/relay";
    url.search = "";
    return url.toString();
  } catch {
    return configRelay;
  }
}

function hasCliRelayOverride(): boolean {
  return process.argv.includes("--relay") || process.argv.some((entry) => entry.startsWith("--relay="));
}

function loadEnvFile(filePath = resolve(process.cwd(), ".env.local")): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry || process.env[entry.key] !== undefined) {
      continue;
    }

    process.env[entry.key] = entry.value;
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
    value:
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue,
  };
}
