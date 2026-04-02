#!/usr/bin/env bun

import { existsSync, readFileSync } from "fs";
import { Socket } from "net";
import { resolve } from "path";

interface ManagedProcess {
  name: string;
  process: Bun.Subprocess<"ignore", "inherit", "inherit">;
}

interface CloudflareTarget {
  controlBaseUrl: string;
  workerUrl: string;
  workerHost: string;
  projectId?: string;
}

const processes: ManagedProcess[] = [];
let shuttingDown = false;
const DEFAULT_ENV_FILE = ".env.local";
const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:17888";

async function main(): Promise<void> {
  loadEnvFile();
  const bridgeUrl = process.env.AMPLINK_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL;
  const target = resolveCloudflareTarget(process.argv.slice(2), process.env);
  const explicitControlUrl = process.env.AMPLINK_CONTROL_URL?.trim();
  const controlUrl =
    explicitControlUrl && !target.projectId
      ? explicitControlUrl
      : buildControlUrl(target.controlBaseUrl, process.env.AMPLINK_DESKTOP_LISTENER_TOKEN);
  const bridgeEndpoint = new URL(bridgeUrl);
  const bridgeHost = bridgeEndpoint.hostname || "127.0.0.1";
  const bridgePort = Number(bridgeEndpoint.port || "17888");

  console.log("[desktop-stack] cloudflare targets", {
    projectId: target.projectId ?? "default",
    controlUrl: redactControlUrl(controlUrl),
    controlHost: getUrlHost(controlUrl) || "unknown",
    workerUrl: target.workerUrl,
    workerHost: target.workerHost,
  });

  if (await isPortListening(bridgePort, bridgeHost)) {
    console.log(`[desktop-stack] bridge already listening on ${bridgeHost}:${bridgePort}; reusing it`);
  } else {
    const bridge = startProcess(
      "bridge",
      ["bun", "run", "src/bridge/main.ts", "--", "--port", String(bridgePort)],
      {
        AMPLINK_BRIDGE_URL: bridgeUrl,
        AMPLINK_CLOUDFLARE_WORKER_URL: target.workerUrl,
      },
    );
    processes.push(bridge);

    // Give the bridge a moment to bind its local port before the listener
    // tries to forward desktop tasks into it.
    await Bun.sleep(500);
  }

  const listener = startProcess(
    "desktop-listener",
    ["bun", "run", "desktop-listener.ts"],
    {
      AMPLINK_BRIDGE_URL: bridgeUrl,
      AMPLINK_CONTROL_URL: "",
      AMPLINK_CONTROL_BASE_URL: target.controlBaseUrl,
      AMPLINK_CLOUDFLARE_WORKER_URL: target.workerUrl,
    },
  );
  processes.push(listener);

  const exitInfo = await waitForFirstExit(processes);
  if (!shuttingDown) {
    const statusText =
      exitInfo.code !== null
        ? `exit code ${exitInfo.code}`
        : `signal ${exitInfo.signalCode ?? "unknown"}`;
    console.error(`[desktop-stack] ${exitInfo.name} exited with ${statusText}`);
    await shutdown(exitInfo.code ?? 1);
  }
}

async function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function startProcess(
  name: string,
  cmd: string[],
  envOverrides: Record<string, string> = {},
): ManagedProcess {
  console.log(`[desktop-stack] starting ${name}`);
  return {
    name,
    process: Bun.spawn(cmd, {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        ...envOverrides,
      },
    }),
  };
}

async function waitForFirstExit(
  managed: ManagedProcess[],
): Promise<{ name: string; code: number | null; signalCode: NodeJS.Signals | null }> {
  return await Promise.race(
    managed.map(async ({ name, process }) => {
      const code = await process.exited;
      return {
        name,
        code,
        signalCode: process.signalCode,
      };
    }),
  );
}

async function shutdown(exitCode = 0): Promise<never> {
  if (shuttingDown) {
    process.exit(exitCode);
  }

  shuttingDown = true;
  console.log("[desktop-stack] shutting down");

  for (const { process } of processes) {
    if (process.exitCode !== null) {
      continue;
    }

    try {
      process.kill("SIGTERM");
    } catch {
      // Ignore races during shutdown.
    }
  }

  await Promise.allSettled(processes.map(({ process }) => process.exited));
  process.exit(exitCode);
}

function loadEnvFile(filePath = resolve(process.cwd(), DEFAULT_ENV_FILE)): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }

    if (process.env[entry.key] === undefined) {
      process.env[entry.key] = entry.value;
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
    value:
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue,
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCloudflareTarget(
  argv: string[],
  env: NodeJS.ProcessEnv,
): CloudflareTarget {
  const projectId = readFlagValue(argv, "--project-id")?.trim();
  const envControlBaseUrl =
    env.AMPLINK_CONTROL_BASE_URL?.trim() || "wss://amplink.arach.workers.dev";
  const envWorkerUrl =
    env.AMPLINK_CLOUDFLARE_WORKER_URL?.trim() || "https://amplink.arach.workers.dev";

  if (!projectId) {
    return {
      controlBaseUrl: envControlBaseUrl,
      workerUrl: envWorkerUrl,
      workerHost: getUrlHost(envWorkerUrl) || "unknown",
    };
  }

  return {
    projectId,
    controlBaseUrl: replaceHostLabel(envControlBaseUrl, projectId),
    workerUrl: replaceHostLabel(envWorkerUrl, projectId),
    workerHost: `${projectId}.${extractHostSuffix(envWorkerUrl)}`,
  };
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === flag) {
      return argv[index + 1];
    }

    if (entry?.startsWith(`${flag}=`)) {
      return entry.slice(flag.length + 1);
    }
  }

  return undefined;
}

function replaceHostLabel(urlValue: string, label: string): string {
  const url = new URL(urlValue);
  const parts = url.hostname.split(".");
  if (parts.length > 0) {
    parts[0] = label;
    url.hostname = parts.join(".");
  }

  return url.toString();
}

function extractHostSuffix(urlValue: string): string {
  const url = new URL(urlValue);
  const parts = url.hostname.split(".");
  return parts.slice(1).join(".");
}

function buildControlUrl(baseUrl: string, token: string | undefined): string {
  try {
    const url = new URL(baseUrl);
    if (token?.trim()) {
      url.searchParams.set("token", token.trim());
    }

    return url.toString();
  } catch {
    return baseUrl;
  }
}

function redactControlUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }

    return url.toString();
  } catch {
    return value.replace(/token=[^&]+/gi, "token=[redacted]");
  }
}

function getUrlHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

await main();
