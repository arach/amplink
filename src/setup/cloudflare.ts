import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, relative } from "path";
import { randomBytes } from "crypto";

const AMPLINK_DIR = join(homedir(), ".amplink");
const CONFIG_FILE = join(AMPLINK_DIR, "config.json");
const HOME_ENV_FILE = join(homedir(), ".env.local");
const DEFAULT_PROJECT_ENV_FILE = ".env.local";
const GENERATED_DIR = ".dev/cloudflare";
const GENERATED_WRANGLER_FILE = "wrangler.cloudflare-setup.toml";
const DEFAULT_WORKER_NAME = "amplink";
const DEFAULT_TOKEN_NAME = "Amplink Setup";
const DEFAULT_ELEVENLABS_VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_USER_ID = "local-dev";

interface SetupConfig {
  relay?: string;
  secure?: boolean;
  port?: number;
  workspace?: { root: string };
  sessions?: Array<{ adapter: string; name: string; cwd?: string; options?: Record<string, unknown> }>;
  cloudflare?: CloudflareSetupState;
  [key: string]: unknown;
}

export interface CloudflareSetupState {
  accountId: string;
  workerName: string;
  workersSubdomain: string;
  workerUrl: string;
  controlBaseUrl: string;
  desktopListenerToken: string;
  adminToken: string;
  elevenlabsVoiceId: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  kvNamespaces: {
    desktops: string;
    desktopsPreview: string;
    voiceProfiles: string;
    voiceProfilesPreview: string;
  };
  generatedWranglerConfigPath: string;
}

interface SetupPaths {
  repoRoot: string;
  projectEnvFile: string;
  generatedWranglerPath: string;
}

interface WranglerConfigInput {
  accountId: string;
  workerName: string;
  workerMainPath: string;
  migrationsDirPath: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  desktopsKvId: string;
  desktopsPreviewKvId: string;
  voiceProfilesKvId: string;
  voiceProfilesPreviewKvId: string;
  elevenlabsVoiceId: string;
}

interface KvNamespace {
  id: string;
  title: string;
}

interface D1Database {
  uuid: string;
  name: string;
}

interface WorkersSubdomainResponse {
  subdomain?: string;
}

interface CloudflareApiEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}

interface CloudflareSetupOptions {
  repoRoot: string;
}

interface PermissionCheckResult {
  key: "workers_scripts" | "workers_kv" | "d1";
  label: string;
  ok: boolean;
  message?: string;
}

interface TokenTemplatePermission {
  key: string;
  type: "read" | "edit" | "revoke" | "run" | "purge";
}

interface TokenTemplateUrls {
  account: string;
  user: string;
}

export function buildCloudflareTokenTemplateUrls(
  tokenName = DEFAULT_TOKEN_NAME,
  accountId = "*",
): TokenTemplateUrls {
  return buildCloudflareTokenTemplateUrl(
    [
      { key: "workers_scripts", type: "edit" },
      // Cloudflare's docs do not provide a ready-made D1 template example, but the
      // dashboard accepts `d1` in practice and pre-fills the D1 permission.
      { key: "d1", type: "edit" },
      // Put Workers KV last. In practice the Cloudflare dashboard has dropped the
      // middle permission from this template, so we bias toward preserving KV.
      { key: "workers_kv", type: "edit" },
    ],
    tokenName,
    accountId,
  );
}

function buildCloudflareTokenTemplateUrl(
  permissions: TokenTemplatePermission[],
  tokenName: string,
  accountId: string,
): TokenTemplateUrls {
  const encodedPermissions = encodeURIComponent(JSON.stringify(permissions));
  const encodedName = encodeURIComponent(tokenName);
  const encodedAccountId = encodeURIComponent(accountId || "*");

  return {
    account:
      `https://dash.cloudflare.com/?to=/:account/api-tokens` +
      `&permissionGroupKeys=${encodedPermissions}` +
      `&name=${encodedName}`,
    user:
      `https://dash.cloudflare.com/profile/api-tokens` +
      `?permissionGroupKeys=${encodedPermissions}` +
      `&accountId=${encodedAccountId}` +
      `&zoneId=all` +
      `&name=${encodedName}`,
  };
}

export function sanitizeWorkerName(input: string, fallback = DEFAULT_WORKER_NAME): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const candidate = normalized || fallback;
  return candidate.slice(0, 63).replace(/-$/g, "") || fallback;
}

export function renderWranglerConfig(input: WranglerConfigInput): string {
  return [
    `name = "${input.workerName}"`,
    `account_id = "${input.accountId}"`,
    `main = "${input.workerMainPath}"`,
    `compatibility_date = "2026-03-31"`,
    `workers_dev = true`,
    `keep_vars = true`,
    "",
    "[ai]",
    `binding = "AI"`,
    "",
    "[[d1_databases]]",
    `binding = "DB"`,
    `database_name = "${input.d1DatabaseName}"`,
    `database_id = "${input.d1DatabaseId}"`,
    `migrations_dir = "${input.migrationsDirPath}"`,
    "",
    "[[kv_namespaces]]",
    `binding = "AMPLINK_DESKTOPS"`,
    `id = "${input.desktopsKvId}"`,
    `preview_id = "${input.desktopsPreviewKvId}"`,
    "",
    "[[kv_namespaces]]",
    `binding = "AMPLINK_VOICE_PROFILES"`,
    `id = "${input.voiceProfilesKvId}"`,
    `preview_id = "${input.voiceProfilesPreviewKvId}"`,
    "",
    "[[durable_objects.bindings]]",
    `name = "AMPLINK_SESSION"`,
    `class_name = "AmplinkSession"`,
    "",
    "[[migrations]]",
    `tag = "v1"`,
    `new_sqlite_classes = ["AmplinkSession"]`,
    "",
    "[[durable_objects.bindings]]",
    `name = "AMPLINK_CONTROL"`,
    `class_name = "AmplinkControlHub"`,
    "",
    "[[migrations]]",
    `tag = "v2"`,
    `new_sqlite_classes = ["AmplinkControlHub"]`,
    "",
    "[[durable_objects.bindings]]",
    `name = "AMPLINK_RELAY_ROOM"`,
    `class_name = "AmplinkRelayRoom"`,
    "",
    "[[migrations]]",
    `tag = "v3"`,
    `new_sqlite_classes = ["AmplinkRelayRoom"]`,
    "",
    "[vars]",
    `DESKTOP_DISPATCH_URL = ""`,
    `ELEVENLABS_MODEL_ID = "${DEFAULT_ELEVENLABS_MODEL_ID}"`,
    `ELEVENLABS_VOICE_ID = "${input.elevenlabsVoiceId}"`,
    `AMPLINK_DEFAULT_USER = "${DEFAULT_USER_ID}"`,
    "",
  ].join("\n");
}

export function upsertEnvFile(
  existing: string,
  updates: Record<string, string | undefined>,
): string {
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const output = [...lines];
  const seen = new Set<string>();

  for (let index = 0; index < output.length; index += 1) {
    const parsed = parseEnvLine(output[index] ?? "");
    if (!parsed) {
      continue;
    }

    const nextValue = updates[parsed.key];
    if (nextValue === undefined) {
      continue;
    }

    output[index] = `${parsed.key}=${quoteEnvValue(nextValue)}`;
    seen.add(parsed.key);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || seen.has(key)) {
      continue;
    }

    output.push(`${key}=${quoteEnvValue(value)}`);
  }

  const joined = output.join("\n").replace(/\n{3,}/g, "\n\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

export async function runCloudflareSetup(
  options: CloudflareSetupOptions,
): Promise<CloudflareSetupState> {
  const paths = getSetupPaths(options.repoRoot);
  const existingConfig = loadConfig();
  const existingState = existingConfig.cloudflare;
  const env = {
    ...loadEnvFile(HOME_ENV_FILE),
    ...loadEnvFile(paths.projectEnvFile),
  };

  console.log("  amplink setup cloudflare");
  console.log("  ─────────────────────────────────");
  console.log("");
  console.log("  This provisions the Amplink Cloudflare backend into your own account.");
  console.log("  The Cloudflare token is used locally for setup only.");
  console.log("");

  const defaultWorkerName = sanitizeWorkerName(existingState?.workerName ?? DEFAULT_WORKER_NAME);
  const workerName = sanitizeWorkerName(
    promptWithDefault("  worker service name", defaultWorkerName),
    defaultWorkerName,
  );
  const tokenName = `${DEFAULT_TOKEN_NAME} (${workerName})`;
  const envAccountId = env.AMPLINK_CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const suggestedAccountId = envAccountId || existingState?.accountId || "";
  const accountId = envAccountId || promptRequired(
    "  Cloudflare account ID (32 chars from the dashboard URL)",
    suggestedAccountId,
  );
  if (envAccountId) {
    console.log(`  ✓ Cloudflare account ID: ${envAccountId}`);
  }
  const templateUrls = buildCloudflareTokenTemplateUrls(tokenName, accountId);

  console.log("");
  console.log("  Step 1: create a scoped Cloudflare token.");
  console.log("  Cloudflare should prefill Workers Scripts, Workers KV Storage, and D1.");
  console.log("  Before creating the token, confirm all three are present.");
  console.log("  If Cloudflare drops one from the template, add it manually:");
  console.log("    Account -> Workers Scripts -> Edit");
  console.log("    Account -> Workers KV Storage -> Edit");
  console.log("    Account -> D1 -> Edit");
  console.log("");
  console.log(`  account token URL : ${templateUrls.account}`);
  console.log("");

  if (promptYesNo("  Open the account token page now?", true)) {
    openExternal(templateUrls.account);
  }

  if (env.CLOUDFLARE_API_TOKEN?.trim() && !env.AMPLINK_CLOUDFLARE_SETUP_TOKEN?.trim()) {
    console.log("  ℹ Ignoring CLOUDFLARE_API_TOKEN for setup. Paste a scoped setup token or set AMPLINK_CLOUDFLARE_SETUP_TOKEN.");
  }

  const configuredVoiceId =
    existingState?.elevenlabsVoiceId ??
    env.ELEVENLABS_VOICE_ID?.trim() ??
    DEFAULT_ELEVENLABS_VOICE_ID;

  console.log("");
  console.log("  Step 1.5: testing Cloudflare token permissions...");
  let pendingSetupToken = env.AMPLINK_CLOUDFLARE_SETUP_TOKEN?.trim() || "";
  let cfToken = "";
  let client: CloudflareApiClient | null = null;

  let isRetest = false;
  while (true) {
    const candidateToken =
      pendingSetupToken ||
      (await promptForCloudflareToken(templateUrls.user));
    if (!candidateToken) {
      throw new Error("Cloudflare API token is required.");
    }

    const candidateClient = new CloudflareApiClient(accountId, candidateToken);
    if (isRetest) {
      console.log("  Re-testing the same Cloudflare token...");
    }
    const permissionChecks = await verifyPermissionsWithRetry(
      candidateClient,
      isRetest ? 5 : 1,
      1200,
    );
    const missingPermissions = permissionChecks.filter((check) => !check.ok);
    if (missingPermissions.length === 0) {
      cfToken = candidateToken;
      client = candidateClient;
      break;
    }

    console.log("");
    const missingBoxTitle =
      missingPermissions.length === 1
        ? "ONE MORE THING"
        : "ONE MORE THING TO ADD";
    const missingBoxLines =
      missingPermissions.length === 1
        ? [`ADD: ${missingPermissions[0]?.label ?? "Unknown permission"}`]
        : missingPermissions.map((check) => `ADD: ${check.label}`);
    console.log(formatAsciiBox(missingBoxTitle, missingBoxLines, 74));
    console.log("");
    console.log("  Amplink is paused before making any Cloudflare changes.");
    console.log("  Update the same token in Cloudflare, then press Enter to re-test it.");
    console.log("");
    console.log("  Required set:");
    console.log("    Account -> Workers Scripts -> Edit");
    console.log("    Account -> Workers KV Storage -> Edit");
    console.log("    Account -> D1 -> Edit");
    console.log("");
    if (promptYesNo("  Reopen the account token page?", true)) {
      openExternal(templateUrls.account);
    }
    waitForEnter("  Press Enter after updating the existing token in Cloudflare to re-test it.");
    console.log("");
    pendingSetupToken = candidateToken;
    isRetest = true;
  }

  if (!client) {
    throw new Error("Cloudflare token verification failed.");
  }
  console.log("  ✓ token can access Workers Scripts, Workers KV Storage, and D1");

  const workersSubdomain = await ensureWorkersSubdomain(
    client,
    existingState?.workersSubdomain ?? suggestedSubdomain(workerName),
  );
  const resourceNames = deriveResourceNames(workerName);

  console.log("");
  console.log("  Step 2: provisioning Cloudflare resources...");
  const desktopsKv = await client.ensureKvNamespace(resourceNames.desktopsKv);
  const desktopsPreviewKv = await client.ensureKvNamespace(resourceNames.desktopsPreviewKv);
  const voiceProfilesKv = await client.ensureKvNamespace(resourceNames.voiceProfilesKv);
  const voiceProfilesPreviewKv = await client.ensureKvNamespace(resourceNames.voiceProfilesPreviewKv);
  const database = await client.ensureD1Database(resourceNames.d1Database);

  mkdirSync(join(options.repoRoot, GENERATED_DIR), { recursive: true });
  const generatedConfigDir = dirname(paths.generatedWranglerPath);
  const wranglerConfig = renderWranglerConfig({
    accountId,
    workerName,
    workerMainPath: toPosixPath(relative(generatedConfigDir, join(options.repoRoot, "cloudflare", "worker.ts"))),
    migrationsDirPath: toPosixPath(relative(generatedConfigDir, join(options.repoRoot, "cloudflare", "migrations"))),
    d1DatabaseName: database.name,
    d1DatabaseId: database.uuid,
    desktopsKvId: desktopsKv.id,
    desktopsPreviewKvId: desktopsPreviewKv.id,
    voiceProfilesKvId: voiceProfilesKv.id,
    voiceProfilesPreviewKvId: voiceProfilesPreviewKv.id,
    elevenlabsVoiceId: configuredVoiceId,
  });
  writeFileSync(paths.generatedWranglerPath, wranglerConfig);

  console.log("  Step 3: applying D1 migrations...");
  await runWrangler(
    options.repoRoot,
    cfToken,
    [
      "d1",
      "migrations",
      "apply",
      database.name,
      "--remote",
      "--config",
      paths.generatedWranglerPath,
    ],
  );

  console.log("  Step 4: deploying the Worker...");
  await runWrangler(
    options.repoRoot,
    cfToken,
    [
      "deploy",
      "--config",
      paths.generatedWranglerPath,
    ],
  );

  console.log("  Step 5: setting core Worker secrets...");
  const desktopListenerToken = existingState?.desktopListenerToken ?? randomToken(24);
  const adminToken = existingState?.adminToken ?? randomToken(24);
  await client.putWorkerSecret(workerName, "DESKTOP_LISTENER_TOKEN", desktopListenerToken);
  await client.putWorkerSecret(workerName, "CONTROL_SHARED_SECRET", adminToken);

  console.log("");
  console.log("  Step 6: optional ElevenLabs setup...");
  const elevenlabsApiKey =
    env.ELEVENLABS_API_KEY?.trim() ||
    (await promptSecret("  ElevenLabs API key (optional, press Enter to skip)"));
  const requestedVoiceId = promptWithDefault(
    "  ElevenLabs voice ID",
    configuredVoiceId,
  );
  const finalVoiceId = requestedVoiceId.trim() || configuredVoiceId;

  if (elevenlabsApiKey) {
    await client.putWorkerSecret(workerName, "ELEVENLABS_API_KEY", elevenlabsApiKey);

    if (finalVoiceId !== configuredVoiceId) {
      console.log("  Updating deployed Worker voice configuration...");
      const updatedWranglerConfig = renderWranglerConfig({
        accountId,
        workerName,
        workerMainPath: toPosixPath(relative(generatedConfigDir, join(options.repoRoot, "cloudflare", "worker.ts"))),
        migrationsDirPath: toPosixPath(relative(generatedConfigDir, join(options.repoRoot, "cloudflare", "migrations"))),
        d1DatabaseName: database.name,
        d1DatabaseId: database.uuid,
        desktopsKvId: desktopsKv.id,
        desktopsPreviewKvId: desktopsPreviewKv.id,
        voiceProfilesKvId: voiceProfilesKv.id,
        voiceProfilesPreviewKvId: voiceProfilesPreviewKv.id,
        elevenlabsVoiceId: finalVoiceId,
      });
      writeFileSync(paths.generatedWranglerPath, updatedWranglerConfig);
      await runWrangler(
        options.repoRoot,
        cfToken,
        [
          "deploy",
          "--config",
          paths.generatedWranglerPath,
        ],
      );
    }
  } else {
    console.log("  ElevenLabs skipped for now. TTS will stay disabled until you add ELEVENLABS_API_KEY later.");
  }

  const workerUrl = `https://${workerName}.${workersSubdomain}.workers.dev`;
  const controlBaseUrl = `wss://${workerName}.${workersSubdomain}.workers.dev`;
  const nextState: CloudflareSetupState = {
    accountId,
    workerName,
    workersSubdomain,
    workerUrl,
    controlBaseUrl,
    desktopListenerToken,
    adminToken,
    elevenlabsVoiceId: finalVoiceId,
    d1DatabaseName: database.name,
    d1DatabaseId: database.uuid,
    kvNamespaces: {
      desktops: desktopsKv.id,
      desktopsPreview: desktopsPreviewKv.id,
      voiceProfiles: voiceProfilesKv.id,
      voiceProfilesPreview: voiceProfilesPreviewKv.id,
    },
    generatedWranglerConfigPath: paths.generatedWranglerPath,
  };

  const projectEnv = existsSync(paths.projectEnvFile)
    ? readFileSync(paths.projectEnvFile, "utf8")
    : "";
  const updatedEnv = upsertEnvFile(projectEnv, {
    AMPLINK_CONTROL_BASE_URL: controlBaseUrl,
    AMPLINK_DESKTOP_LISTENER_TOKEN: desktopListenerToken,
    AMPLINK_CLOUDFLARE_WORKER_URL: workerUrl,
    AMPLINK_CLOUDFLARE_ADMIN_URL: `${workerUrl}/admin?token=${encodeURIComponent(adminToken)}`,
  });
  writeFileSync(paths.projectEnvFile, updatedEnv);

  saveConfig({
    ...existingConfig,
    cloudflare: nextState,
  });

  console.log("");
  console.log("  ✓ Cloudflare setup complete");
  console.log(`  worker URL      : ${workerUrl}`);
  console.log(`  admin URL       : ${workerUrl}/admin?token=${encodeURIComponent(adminToken)}`);
  console.log(`  desktop control : ${controlBaseUrl}`);
  console.log(`  local env       : ${paths.projectEnvFile}`);
  console.log("");
  console.log("  next:");
  console.log("    bun run desktop:listen");
  console.log("    or bun run desktop:up");
  console.log("");

  return nextState;
}

function deriveResourceNames(workerName: string): {
  desktopsKv: string;
  desktopsPreviewKv: string;
  voiceProfilesKv: string;
  voiceProfilesPreviewKv: string;
  d1Database: string;
} {
  return {
    desktopsKv: `${workerName}-desktops`,
    desktopsPreviewKv: `${workerName}-desktops-preview`,
    voiceProfilesKv: `${workerName}-voice-profiles`,
    voiceProfilesPreviewKv: `${workerName}-voice-profiles-preview`,
    d1Database: `${workerName}-db`,
  };
}

function getSetupPaths(repoRoot: string): SetupPaths {
  return {
    repoRoot,
    projectEnvFile: join(repoRoot, DEFAULT_PROJECT_ENV_FILE),
    generatedWranglerPath: join(repoRoot, GENERATED_DIR, GENERATED_WRANGLER_FILE),
  };
}

function suggestedSubdomain(workerName: string): string {
  return sanitizeWorkerName(`${workerName}-${randomToken(3)}`);
}

function loadConfig(): SetupConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as SetupConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: SetupConfig): void {
  mkdirSync(AMPLINK_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const text = readFileSync(path, "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) {
      env[entry.key] = entry.value;
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
  if (!match?.[1]) {
    return null;
  }

  return {
    key: match[1],
    value: stripQuotes((match[2] ?? "").trim()),
  };
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

function quoteEnvValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function formatAsciiBox(title: string, lines: string[], width = 78): string {
  const innerWidth = Math.max(20, width - 4);
  const output: string[] = [];
  const border = `+${"-".repeat(innerWidth + 2)}+`;

  output.push(border);
  output.push(...renderBoxLine(title.toUpperCase(), innerWidth));
  output.push(...renderBoxLine("", innerWidth));

  for (const line of lines) {
    const wrapped = wrapBoxText(line, innerWidth);
    if (wrapped.length === 0) {
      output.push(...renderBoxLine("", innerWidth));
      continue;
    }

    for (const wrappedLine of wrapped) {
      output.push(...renderBoxLine(wrappedLine, innerWidth));
    }
  }

  output.push(border);
  return output.join("\n");
}

function renderBoxLine(text: string, innerWidth: number): string[] {
  return [`| ${text.padEnd(innerWidth, " ")} |`];
}

function wrapBoxText(text: string, innerWidth: number): string[] {
  if (!text) {
    return [];
  }

  const indentMatch = text.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? "";
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [indent];
  }

  const lines: string[] = [];
  let current = indent;

  for (const word of words) {
    const candidate = current.trim().length === 0 ? `${indent}${word}` : `${current} ${word}`;
    if (candidate.length <= innerWidth) {
      current = candidate;
      continue;
    }

    if (current.trim().length > 0) {
      lines.push(current);
      current = `${indent}${word}`;
      continue;
    }

    lines.push(candidate.slice(0, innerWidth));
    current = `${indent}${candidate.slice(innerWidth).trimStart()}`;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function promptWithDefault(label: string, defaultValue: string): string {
  const answer = prompt(`${label} [${defaultValue}]:`)?.trim();
  return answer && answer.length > 0 ? answer : defaultValue;
}

function promptRequired(label: string, defaultValue = ""): string {
  while (true) {
    const value = promptWithDefault(label, defaultValue).trim();
    if (value.length > 0) {
      return value;
    }
  }
}

function promptYesNo(label: string, defaultValue: boolean): boolean {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = prompt(`${label} [${suffix}]:`)?.trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  return answer === "y" || answer === "yes";
}

function waitForEnter(label: string): void {
  prompt(`${label}`);
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return prompt(`${label}:`)?.trim() ?? "";
  }

  process.stdout.write(`${label}: `);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value.trim());
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(1);
        }

        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

async function promptForCloudflareToken(userTokenUrl: string): Promise<string> {
  while (true) {
    const value = await promptSecret("  Cloudflare API token");
    if (value) {
      return value;
    }

    console.log("");
    console.log("  No token entered.");
    if (!promptYesNo("  Couldn't create an account token? Open the fallback user-token page?", false)) {
      continue;
    }

    console.log(`  user token URL    : ${userTokenUrl}`);
    openExternal(userTokenUrl);
    console.log("");
  }
}

async function verifyPermissionsWithRetry(
  client: CloudflareApiClient,
  attempts: number,
  delayMs: number,
): Promise<PermissionCheckResult[]> {
  let lastChecks = await client.verifyRequiredPermissions();
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (lastChecks.every((check) => check.ok)) {
      return lastChecks;
    }

    await Bun.sleep(delayMs);
    lastChecks = await client.verifyRequiredPermissions();
  }

  return lastChecks;
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function openExternal(url: string): void {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  try {
    Bun.spawn({
      cmd: [opener, url],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      detached: true,
    });
  } catch {
    console.log(`  open manually: ${url}`);
  }
}

async function runWrangler(
  repoRoot: string,
  cfToken: string,
  args: string[],
): Promise<void> {
  const script = join(repoRoot, "scripts", "run-wrangler.ts");
  const subprocess = Bun.spawn({
    cmd: ["bun", "run", script, ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: cfToken,
      CI: "1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`Wrangler command failed: ${args.join(" ")}`);
  }
}

async function ensureWorkersSubdomain(
  client: CloudflareApiClient,
  defaultValue: string,
): Promise<string> {
  const existing = await client.getWorkersSubdomain();
  if (existing) {
    console.log(`  using existing workers.dev subdomain: ${existing}`);
    return existing;
  }

  console.log("");
  console.log("  This account does not have a workers.dev subdomain yet.");

  while (true) {
    const value = sanitizeWorkerName(
      promptWithDefault("  workers.dev subdomain", defaultValue),
      defaultValue,
    );
    try {
      const created = await client.createWorkersSubdomain(value);
      console.log(`  created workers.dev subdomain: ${created}`);
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [setup] failed to create workers.dev subdomain: ${message}`);
      console.log("  Try another subdomain.");
    }
  }
}

class CloudflareApiClient {
  constructor(
    private readonly accountId: string,
    private readonly token: string,
  ) {}

  async ensureKvNamespace(title: string): Promise<KvNamespace> {
    const existing = await this.listKvNamespaces();
    const match = existing.find((namespace) => namespace.title === title);
    if (match) {
      return match;
    }

    return this.request<KvNamespace>(
      `/accounts/${this.accountId}/storage/kv/namespaces`,
      {
        method: "POST",
        body: JSON.stringify({ title }),
      },
    );
  }

  async ensureD1Database(name: string): Promise<D1Database> {
    const existing = await this.listD1Databases();
    const match = existing.find((database) => database.name === name);
    if (match) {
      return match;
    }

    return this.request<D1Database>(
      `/accounts/${this.accountId}/d1/database`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );
  }

  async getWorkersSubdomain(): Promise<string | null> {
    const response = await this.request<WorkersSubdomainResponse | null>(
      `/accounts/${this.accountId}/workers/subdomain`,
      { method: "GET" },
    );

    return response?.subdomain?.trim() || null;
  }

  async createWorkersSubdomain(subdomain: string): Promise<string> {
    const response = await this.request<WorkersSubdomainResponse>(
      `/accounts/${this.accountId}/workers/subdomain`,
      {
        method: "PUT",
        body: JSON.stringify({ subdomain }),
      },
    );

    if (!response.subdomain?.trim()) {
      throw new Error("Cloudflare returned an empty workers.dev subdomain.");
    }

    return response.subdomain;
  }

  async putWorkerSecret(scriptName: string, secretName: string, value: string): Promise<void> {
    await this.request(
      `/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: secretName,
          text: value,
          type: "secret_text",
        }),
      },
    );
  }

  async verifyRequiredPermissions(): Promise<PermissionCheckResult[]> {
    const checks: Array<Promise<PermissionCheckResult>> = [
      this.checkPermission(
        "workers_scripts",
        "Account -> Workers Scripts -> Edit",
        () => this.request(`/accounts/${this.accountId}/workers/subdomain`, { method: "GET" }),
      ),
      this.checkPermission(
        "workers_kv",
        "Account -> Workers KV Storage -> Edit",
        () => this.request(`/accounts/${this.accountId}/storage/kv/namespaces?page=1&per_page=1`, { method: "GET" }),
      ),
      this.checkPermission(
        "d1",
        "Account -> D1 -> Edit",
        () => this.request(`/accounts/${this.accountId}/d1/database`, { method: "GET" }),
      ),
    ];

    return Promise.all(checks);
  }

  private async listKvNamespaces(): Promise<KvNamespace[]> {
    return this.request<KvNamespace[]>(
      `/accounts/${this.accountId}/storage/kv/namespaces?page=1&per_page=100`,
      { method: "GET" },
    );
  }

  private async listD1Databases(): Promise<D1Database[]> {
    return this.request<D1Database[]>(
      `/accounts/${this.accountId}/d1/database`,
      { method: "GET" },
    );
  }

  private async checkPermission(
    key: PermissionCheckResult["key"],
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<PermissionCheckResult> {
    try {
      await fn();
      return { key, label, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        key,
        label,
        ok: false,
        message,
      };
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const payload = await response.json() as CloudflareApiEnvelope<T>;
    if (!response.ok || !payload.success) {
      const errorMessage =
        payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        response.statusText ||
        "Cloudflare API request failed.";
      throw new Error(errorMessage);
    }

    return payload.result;
  }
}
