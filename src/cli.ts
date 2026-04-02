#!/usr/bin/env bun
// Amplink CLI
//
// Usage:
//   amplink init                    — Set up the CF-only desktop flow
//   amplink desktop up              — Start local bridge + desktop listener
//   amplink desktop listen          — Start only the desktop listener
//   amplink start                   — Start bridge + relay
//   amplink pair                    — Show QR code for phone pairing
//   amplink open <project>          — Open a project session (starts bridge if needed)
//   amplink status                  — Show running sessions
//   amplink config                  — View current config
//   amplink config set <key> <val>  — Update a config value
//   amplink workspace               — List projects in workspace
//   amplink workspace add <path>    — Add a project to auto-start
//   amplink setup cloudflare        — Provision the Cloudflare voice backend

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { runCloudflareSetup } from "./setup/cloudflare.ts";
import type { AdapterEntry } from "./bridge/config.ts";

const AMPLINK_DIR = join(homedir(), ".amplink");
const CONFIG_FILE = join(AMPLINK_DIR, "config.json");
const DEFAULT_WORKSPACE_ROOT = "~/dev";
const DEFAULT_BRIDGE_PORT = 17888;
const DEFAULT_CF_CONTROL_BASE_URL = "wss://amplink.arach.workers.dev";
const DEFAULT_CF_WORKER_URL = "https://amplink.arach.workers.dev";
const DEFAULT_INIT_ADAPTER = "codex";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface Config {
  relay?: string;
  secure?: boolean;
  port?: number;
  adapters?: Record<string, AdapterEntry>;
  workspace?: { root: string };
  sessions?: Array<{ adapter: string; name: string; cwd?: string; options?: Record<string, unknown> }>;
  cloudflare?: {
    accountId?: string;
  };
  [key: string]: unknown;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config: Config): void {
  mkdirSync(AMPLINK_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

function resolvePath(p: string): string {
  return resolve(p.replace(/^~/, homedir()));
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    const rawValue = withoutExport.slice(separator + 1).trim();
    values[key] =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
  }

  return values;
}

function upsertEnvFile(path: string, updates: Record<string, string | undefined>): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const merged = {
    ...parseEnvFile(existing),
    ...Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ),
  };

  const orderedKeys = [
    "AMPLINK_CLOUDFLARE_PROJECT_ID",
    "AMPLINK_CONTROL_BASE_URL",
    "AMPLINK_CLOUDFLARE_WORKER_URL",
    "AMPLINK_DESKTOP_LISTENER_TOKEN",
    "AMPLINK_BRIDGE_URL",
  ];

  const keys = [
    ...orderedKeys.filter((key) => key in merged),
    ...Object.keys(merged).filter((key) => !orderedKeys.includes(key)),
  ];

  const lines = keys.map((key) => `${key}="${merged[key]}"`);
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function looksLikeProject(path: string): boolean {
  return [
    ".git",
    "package.json",
    "Package.swift",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
  ].some((marker) => existsSync(join(path, marker)));
}

function inferProjectPath(): string | null {
  const cwd = process.cwd();
  if (cwd === homedir()) return null;
  return looksLikeProject(cwd) ? cwd : null;
}

function deriveRelayUrlFromWorker(workerUrl?: string): string | undefined {
  if (!workerUrl) return undefined;
  try {
    const url = new URL(workerUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
    url.pathname = "/relay";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}


// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  console.log("  amplink init");
  console.log("  ─────────────────────────────────\n");

  mkdirSync(AMPLINK_DIR, { recursive: true });
  const config = loadConfig();
  const workspaceRoot = getArg("--workspace-root") ?? config.workspace?.root ?? DEFAULT_WORKSPACE_ROOT;
  const bridgePort = Number(getArg("--port") ?? config.port ?? DEFAULT_BRIDGE_PORT);
  const bridgeUrl = `ws://127.0.0.1:${bridgePort}`;
  const savedAccountId = config.cloudflare?.accountId?.trim() || "";
  const envAccountId = process.env.AMPLINK_CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const accountIdDefault = getArg("--account-id") ?? envAccountId ?? savedAccountId;
  const inferredProject = hasFlag("--no-project") ? null : inferProjectPath();

  config.workspace = { root: workspaceRoot };
  config.secure = true;
  config.port = Number.isFinite(bridgePort) && bridgePort > 0 ? bridgePort : DEFAULT_BRIDGE_PORT;
  config.cloudflare ??= {};

  if (!config.cloudflare.accountId) {
    const prompted =
      accountIdDefault ||
      (prompt("  Cloudflare account ID (32 chars from the dashboard URL):") || "").trim();
    if (!prompted) {
      console.error("\n  Cloudflare account ID is required. Run amplink init again.");
      process.exit(1);
    }
    config.cloudflare.accountId = prompted;
  }

  console.log(`  ✓ workspace: ${config.workspace.root}`);
  console.log(`  ✓ bridge   : ${bridgeUrl}`);
  console.log(`  ✓ account  : ${config.cloudflare.accountId}`);

  // Generate identity
  const identityFile = join(AMPLINK_DIR, "identity.json");
  if (!existsSync(identityFile)) {
    // Import and call loadOrCreateIdentity to generate keys
    const { loadOrCreateIdentity, bytesToHex } = await import("./security/index.ts");
    const identity = loadOrCreateIdentity();
    console.log(`  ✓ identity generated: ${bytesToHex(identity.publicKey).slice(0, 16)}...`);
  } else {
    console.log(`  ✓ identity: exists`);
  }

  config.sessions ??= [];
  if (inferredProject) {
    const projectName = basename(inferredProject);
    const existing = config.sessions.find((session) => session.cwd === inferredProject);
    if (!existing) {
      config.sessions.push({
        adapter: DEFAULT_INIT_ADAPTER,
        name: projectName,
        cwd: inferredProject,
      });
      console.log(`  ✓ session  : ${projectName} (${DEFAULT_INIT_ADAPTER})`);
    } else {
      console.log(`  ✓ session  : ${existing.name} (${existing.adapter})`);
    }
  } else {
    console.log(`  ℹ session  : no current project detected`);
  }

  saveConfig(config);

  const envFile = join(findAmplinkRoot(), ".env.local");
  upsertEnvFile(envFile, {
    AMPLINK_CLOUDFLARE_ACCOUNT_ID: config.cloudflare.accountId,
    AMPLINK_BRIDGE_URL: bridgeUrl,
  });
  console.log(`  ✓ env      : ${envFile}`);

  console.log(`\n  config saved to ${CONFIG_FILE}`);
  console.log(`\n  next steps:`);
  console.log(`    1. bun run setup:cloudflare`);
  console.log(`       (choose the worker/project label, grant permissions, mint listener token)`);
  console.log(`    2. bun run desktop:up`);
  console.log(`    3. ./bin/amplink-dev deploy`);
  console.log("");
}

function start(): void {
  const config = loadConfig();

  if (!existsSync(CONFIG_FILE)) {
    console.error("  amplink is not initialized. Run: amplink init");
    process.exit(1);
  }

  console.log("  starting amplink...\n");

  // Start relay in background
  const relayProc = spawn("bun", ["run", "src/relay/main.ts"], {
    cwd: findAmplinkRoot(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  relayProc.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`  ${line}`);
  });

  relayProc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`  ${line}`);
  });

  // Give relay a moment to start, then start bridge
  setTimeout(() => {
    const bridgeProc = spawn("bun", ["run", "src/bridge/main.ts"], {
      cwd: findAmplinkRoot(),
      stdio: "inherit",
      detached: false,
    });

    // Clean up both on exit
    const cleanup = () => {
      relayProc.kill();
      bridgeProc.kill();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    bridgeProc.on("exit", (code) => {
      relayProc.kill();
      process.exit(code ?? 0);
    });
  }, 500);
}

function desktop(subcommand?: string): void {
  const root = findAmplinkRoot();

  switch (subcommand ?? "up") {
    case "up": {
      const proc = spawn("bun", ["run", "desktop:up"], {
        cwd: root,
        stdio: "inherit",
      });
      process.on("SIGINT", () => { proc.kill(); process.exit(0); });
      process.on("SIGTERM", () => { proc.kill(); process.exit(0); });
      proc.on("exit", (code) => process.exit(code ?? 0));
      return;
    }

    case "listen": {
      const proc = spawn("bun", ["run", "desktop:listen"], {
        cwd: root,
        stdio: "inherit",
      });
      process.on("SIGINT", () => { proc.kill(); process.exit(0); });
      process.on("SIGTERM", () => { proc.kill(); process.exit(0); });
      proc.on("exit", (code) => process.exit(code ?? 0));
      return;
    }

    default:
      console.error("  usage: amplink desktop <up|listen>");
      process.exit(1);
  }
}

async function pair(): Promise<void> {
  if (!existsSync(CONFIG_FILE)) {
    console.error("  amplink is not initialized. Run: amplink init");
    process.exit(1);
  }

  const root = findAmplinkRoot();
  const config = loadConfig();
  const workerUrl = process.env.AMPLINK_CLOUDFLARE_WORKER_URL?.trim() || DEFAULT_CF_WORKER_URL;
  const relayUrl = config.relay ?? deriveRelayUrlFromWorker(workerUrl);

  if (!relayUrl) {
    console.error("  amplink pair needs either a relay URL or a configured Cloudflare worker URL.");
    console.error("  run: amplink setup cloudflare");
    process.exit(1);
  }

  const [{ Bridge }, { createAdapterRegistry }, { connectToRelay }, { printQRCode }, { loadOrCreateIdentity }] = await Promise.all([
    import("./bridge/bridge.ts"),
    import("./bridge/adapters.ts"),
    import("./bridge/relay-client.ts"),
    import("./bridge/qr.ts"),
    import("./security/index.ts"),
  ]);

  const identity = loadOrCreateIdentity();
  const bridge = new Bridge({ adapters: createAdapterRegistry(config.adapters) });
  const relayConnection = connectToRelay(relayUrl, identity, bridge, {
    secure: true,
    cloudflareBaseUrl: workerUrl,
  });

  printQRCode(relayConnection.qrPayload);
  console.log("[pair] waiting for the phone to scan and trust this bridge...");
  console.log("[pair] press Ctrl+C when pairing is complete");

  const shutdown = (): void => {
    relayConnection.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

function status(): void {
  const config = loadConfig();
  console.log("  amplink status");
  console.log("  ─────────────────────────────────\n");

  if (!existsSync(CONFIG_FILE)) {
    console.log("  not initialized — run: amplink init\n");
    return;
  }

  console.log(`  config  : ${CONFIG_FILE}`);
  console.log(`  relay   : ${config.relay ?? "not set"}`);
  console.log(`  port    : ${config.port ?? DEFAULT_BRIDGE_PORT}`);
  console.log(`  root    : ${config.workspace?.root ?? "not set"}`);
  console.log(`  sessions: ${config.sessions?.length ?? 0} auto-start`);

  const identityFile = join(AMPLINK_DIR, "identity.json");
  if (existsSync(identityFile)) {
    try {
      const id = JSON.parse(readFileSync(identityFile, "utf8"));
      console.log(`  identity: ${(id.publicKey as string).slice(0, 16)}...`);
    } catch { /* skip */ }
  }

  console.log("");
}

function showConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log("  no config — run: amplink init");
    return;
  }
  console.log(readFileSync(CONFIG_FILE, "utf8"));
}

function configSet(key: string, value: string): void {
  const config = loadConfig();

  // Handle nested keys like "workspace.root"
  const parts = key.split(".");
  let target: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i]! in target)) target[parts[i]!] = {};
    target = target[parts[i]!];
  }

  // Auto-detect type
  const lastKey = parts[parts.length - 1]!;
  if (value === "true") target[lastKey] = true;
  else if (value === "false") target[lastKey] = false;
  else if (!isNaN(Number(value)) && value !== "") target[lastKey] = Number(value);
  else target[lastKey] = value;

  saveConfig(config);
  console.log(`  ${key} = ${JSON.stringify(target[lastKey])}`);
}

function workspace(subPath?: string): void {
  const config = loadConfig();
  const root = config.workspace?.root;

  if (!root) {
    console.error("  no workspace root configured. Run: amplink init");
    process.exit(1);
  }

  const resolvedRoot = resolvePath(root);
  const browsePath = subPath ? join(resolvedRoot, subPath) : resolvedRoot;

  console.log(`  ${browsePath}\n`);

  try {
    const entries = readdirSync(browsePath);
    for (const name of entries.sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;

      const fullPath = join(browsePath, name);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch { continue; }

      const children = new Set(readdirSync(fullPath));
      const markers: string[] = [];
      if (children.has(".git")) markers.push("git");
      if (children.has("package.json")) markers.push("pkg");
      if (children.has("Package.swift")) markers.push("swift");
      if (children.has("Cargo.toml")) markers.push("rust");
      if (children.has("go.mod")) markers.push("go");
      if (children.has("pyproject.toml") || children.has("setup.py")) markers.push("py");

      const tag = markers.length ? ` [${markers.join(", ")}]` : "";
      console.log(`  ${name}${tag}`);
    }
  } catch (err: any) {
    console.error(`  error: ${err.message}`);
  }

  console.log("");
}

function open(project: string, adapter?: string): void {
  const config = loadConfig();
  const root = config.workspace?.root;

  let projectPath: string;
  if (project.startsWith("/") || project.startsWith("~")) {
    projectPath = resolvePath(project);
  } else if (root) {
    projectPath = join(resolvePath(root), project);
  } else {
    projectPath = resolve(project);
  }

  if (!existsSync(projectPath)) {
    console.error(`  not found: ${projectPath}`);
    process.exit(1);
  }

  const adapterType = adapter ?? "claude-code";
  const name = basename(projectPath);

  // Add to sessions in config
  config.sessions ??= [];
  const existing = config.sessions.find(s => s.cwd === projectPath || s.cwd === project);
  if (!existing) {
    config.sessions.push({ adapter: adapterType, name, cwd: projectPath });
    saveConfig(config);
    console.log(`  added: ${name} (${adapterType}) → ${projectPath}`);
  } else {
    console.log(`  already configured: ${name}`);
  }

  console.log(`  restart bridge to activate, or it will start on next: amplink start`);
}

// ---------------------------------------------------------------------------
// Find the amplink source root (for spawning bridge/relay)
// ---------------------------------------------------------------------------

function findAmplinkRoot(): string {
  // Check common locations
  const candidates = [
    join(homedir(), "dev", "amplink"),
    join(homedir(), "dev", "ext", "amplink"),
    process.cwd(),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "src", "bridge", "main.ts"))) {
      return dir;
    }
  }

  // Fallback: relative to this script
  const scriptDir = import.meta.dir;
  const root = join(scriptDir, "..");
  if (existsSync(join(root, "src", "bridge", "main.ts"))) {
    return root;
  }

  console.error("  cannot find amplink source. Run from the amplink directory.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "init":
    await init();
    break;

  case "start":
    start();
    break;

  case "desktop":
    desktop(args[0]);
    break;

  case "pair":
    await pair();
    break;

  case "status":
    status();
    break;

  case "config":
    if (args[0] === "set" && args[1] && args[2]) {
      configSet(args[1], args[2]);
    } else {
      showConfig();
    }
    break;

  case "workspace":
  case "ws":
    workspace(args[0]);
    break;

  case "open":
    if (!args[0]) {
      console.error("  usage: amplink open <project> [--adapter codex]");
      process.exit(1);
    }
    open(args[0], args.includes("--adapter") ? args[args.indexOf("--adapter") + 1] : undefined);
    break;

  case "setup":
    if (args[0] !== "cloudflare") {
      console.error("  usage: amplink setup cloudflare");
      process.exit(1);
    }
    await runCloudflareSetup({ repoRoot: findAmplinkRoot() });
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(`
  amplink — universal viewport for AI coding sessions

  commands:
    init                     set up the CF-only desktop flow
    desktop <up|listen>      run the local desktop-side processes
    start                    start bridge + relay
    pair                     show QR code for phone pairing
    open <project>           add a project session (--adapter codex)
    setup cloudflare         provision the Cloudflare voice backend
    status                   show amplink status
    config                   view config
    config set <key> <val>   update config (e.g. workspace.root ~/dev)
    workspace [path]         browse projects (alias: ws)

  examples:
    amplink init
    amplink desktop up
    amplink desktop listen
    amplink init --project-id demo
    amplink open amplink
    amplink open myapp --adapter codex
    amplink setup cloudflare
    amplink ws ext
    amplink config set relay wss://my-host:7889
    amplink start
`);
    break;

  default:
    console.error(`  unknown command: ${cmd}\n  run: amplink --help`);
    process.exit(1);
}
