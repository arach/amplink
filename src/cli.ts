#!/usr/bin/env bun
// Amplink CLI
//
// Usage:
//   amplink init                    — Set up workspace, identity, and config
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
import { execSync, spawn, type ChildProcess } from "child_process";
import { runCloudflareSetup } from "./setup/cloudflare.ts";

const AMPLINK_DIR = join(homedir(), ".amplink");
const CONFIG_FILE = join(AMPLINK_DIR, "config.json");

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface Config {
  relay?: string;
  secure?: boolean;
  port?: number;
  workspace?: { root: string };
  sessions?: Array<{ adapter: string; name: string; cwd?: string; options?: Record<string, unknown> }>;
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  console.log("  amplink init");
  console.log("  ─────────────────────────────────\n");

  mkdirSync(AMPLINK_DIR, { recursive: true });
  const config = loadConfig();

  // Workspace root
  if (!config.workspace?.root) {
    const defaultRoot = "~/dev";
    const root = prompt(`  workspace root [${defaultRoot}]:`) || defaultRoot;
    config.workspace = { root };
    console.log(`  ✓ workspace: ${root}`);
  } else {
    console.log(`  ✓ workspace: ${config.workspace.root} (already set)`);
  }

  // Relay
  if (!config.relay) {
    // Try to detect Tailscale
    let defaultRelay = "wss://localhost:7889";
    try {
      const tsOutput = execSync("tailscale status --self=true --peers=false --json", {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).toString();
      const tsData = JSON.parse(tsOutput);
      const dnsName = (tsData?.Self?.DNSName ?? "").replace(/\.$/, "");
      if (dnsName) {
        defaultRelay = `wss://${dnsName}:7889`;
        console.log(`  ℹ Tailscale detected: ${dnsName}`);
      }
    } catch { /* no tailscale */ }

    const relay = prompt(`  relay URL [${defaultRelay}]:`) || defaultRelay;
    config.relay = relay;
    config.secure = true;
    console.log(`  ✓ relay: ${relay}`);
  } else {
    console.log(`  ✓ relay: ${config.relay} (already set)`);
  }

  // Port
  if (!config.port) {
    config.port = 7888;
    console.log(`  ✓ port: 7888`);
  }

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

  // TLS cert
  const hasCert = readdirSync(AMPLINK_DIR).some(f => f.endsWith(".crt"));
  if (!hasCert) {
    console.log(`  ℹ TLS cert will be auto-generated on first relay start`);
  } else {
    console.log(`  ✓ TLS cert: exists`);
  }

  saveConfig(config);

  console.log(`\n  config saved to ${CONFIG_FILE}`);
  console.log(`\n  next steps:`);
  console.log(`    amplink start        — start bridge + relay`);
  console.log(`    amplink workspace    — browse your projects`);
  console.log(`    amplink pair         — show QR code for phone`);
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

function pair(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.error("  amplink is not initialized. Run: amplink init");
    process.exit(1);
  }

  // Just start bridge in pair mode — it shows QR
  const proc = spawn("bun", ["run", "src/bridge/main.ts", "--pair"], {
    cwd: findAmplinkRoot(),
    stdio: "inherit",
  });

  process.on("SIGINT", () => { proc.kill(); process.exit(0); });
  proc.on("exit", (code) => process.exit(code ?? 0));
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
  console.log(`  port    : ${config.port ?? 7888}`);
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

  case "pair":
    pair();
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
    init                     set up workspace, identity, and config
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
