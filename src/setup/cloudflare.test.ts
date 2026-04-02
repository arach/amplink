import { describe, expect, test } from "bun:test";
import {
  buildCloudflareTokenTemplateUrls,
  renderWranglerConfig,
  sanitizeWorkerName,
  upsertEnvFile,
} from "./cloudflare.ts";

describe("cloudflare setup helpers", () => {
  test("builds token template URLs with prefilled permissions and name", () => {
    const urls = buildCloudflareTokenTemplateUrls("Amplink Setup", "abc123");

    expect(urls.account).toContain("dash.cloudflare.com/?to=/:account/api-tokens");
    expect(urls.account).toContain("name=Amplink%20Setup");
    expect(decodeURIComponent(urls.account)).toContain('"key":"workers_scripts"');
    expect(decodeURIComponent(urls.account)).toContain('"key":"workers_kv"');
    expect(decodeURIComponent(urls.account)).toContain('"key":"d1"');

    expect(urls.user).toContain("dash.cloudflare.com/profile/api-tokens");
    expect(urls.user).toContain("accountId=abc123");
  });

  test("sanitizes worker names to workers.dev friendly slugs", () => {
    expect(sanitizeWorkerName(" Amplink Voice!! ")).toBe("amplink-voice");
    expect(sanitizeWorkerName("---")).toBe("amplink");
  });

  test("renders a self-contained wrangler config", () => {
    const config = renderWranglerConfig({
      accountId: "account-123",
      workerName: "amplink-demo",
      workerMainPath: "../../cloudflare/worker.ts",
      migrationsDirPath: "../../cloudflare/migrations",
      d1DatabaseName: "amplink-demo-db",
      d1DatabaseId: "db-123",
      desktopsKvId: "kv-a",
      desktopsPreviewKvId: "kv-b",
      voiceProfilesKvId: "kv-c",
      voiceProfilesPreviewKvId: "kv-d",
      elevenlabsVoiceId: "voice-123",
    });

    expect(config).toContain('name = "amplink-demo"');
    expect(config).toContain('account_id = "account-123"');
    expect(config).toContain('database_name = "amplink-demo-db"');
    expect(config).toContain('ELEVENLABS_VOICE_ID = "voice-123"');
    expect(config).toContain('main = "../../cloudflare/worker.ts"');
    expect(config).toContain('migrations_dir = "../../cloudflare/migrations"');
    expect(config).toContain('name = "AMPLINK_RELAY_ROOM"');
    expect(config).toContain('class_name = "AmplinkRelayRoom"');
    expect(config).toContain('tag = "v3"');
    expect(config).toContain('new_sqlite_classes = ["AmplinkRelayRoom"]');
  });

  test("upserts local env values without dropping existing lines", () => {
    const result = upsertEnvFile(
      'FOO="bar"\nEXISTING="1"\n',
      {
        EXISTING: "2",
        AMPLINK_CONTROL_BASE_URL: "wss://demo.workers.dev",
      },
    );

    expect(result).toContain('FOO="bar"');
    expect(result).toContain('EXISTING="2"');
    expect(result).toContain('AMPLINK_CONTROL_BASE_URL="wss://demo.workers.dev"');
  });
});
