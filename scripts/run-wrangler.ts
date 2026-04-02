import { homedir } from "node:os";
import { join } from "node:path";

const ENV_FILES = [
  join(homedir(), ".env.local"),
  join(process.cwd(), ".env.local"),
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("[run-wrangler] Missing Wrangler arguments.");
    process.exit(1);
  }

  const mergedEnv = {
    ...process.env,
    ...(await loadEnvFiles(ENV_FILES)),
  };

  const wranglerBinary =
    Bun.which("wrangler") ||
    Bun.which(join(process.cwd(), "node_modules", ".bin", "wrangler"));
  if (!wranglerBinary) {
    console.error("[run-wrangler] Could not find `wrangler` on PATH or in node_modules/.bin.");
    process.exit(1);
  }

  const subprocess = Bun.spawn({
    cmd: [wranglerBinary, ...args],
    cwd: process.cwd(),
    env: mergedEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await subprocess.exited;
  process.exit(exitCode);
}

async function loadEnvFiles(paths: string[]): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      continue;
    }

    const text = await file.text();
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }

      env[parsed.key] = parsed.value;
    }
  }

  return env;
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return null;
  }

  const key = match[1];
  const rawValue = match[2];
  if (!key || rawValue == null) {
    return null;
  }

  const value = stripQuotes(rawValue.trim());
  return { key, value };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

await main();
