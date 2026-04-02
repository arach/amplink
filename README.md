# amplink

To install dependencies:

```bash
bun install
```

Quick CF-only desktop setup:

```bash
amplink init --project-id YOUR_WORKER_LABEL
# then add AMPLINK_DESKTOP_LISTENER_TOKEN to .env.local
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Cloudflare voice backend

The repo now includes a Cloudflare Workers backend under [cloudflare/worker.ts](/Users/arach/dev/amplink/cloudflare/worker.ts) with a Durable Object per voice session in [cloudflare/amplink-session.ts](/Users/arach/dev/amplink/cloudflare/amplink-session.ts). It provides:

- `GET /sessions` to list a user's sessions from D1
- `POST /start-session` to create a new voice session
- `GET /ws?session={id}&device=mobile` to attach the mobile client to the session Durable Object
- `GET /listen?token={token}` to attach the desktop listener over WebSocket
- `GET /admin` for the built-in voice admin web UI
- `GET/PUT /api/voice-profile` to read or update the live per-user voice profile
- `POST /api/voice-preview` to preview the current voice/personality before saving
- `/control/*` routes from [cloudflare/control.ts](/Users/arach/dev/amplink/cloudflare/control.ts) for legacy desktop endpoint registration in KV

### BYO Cloudflare setup

If you want Amplink to deploy into your own Cloudflare account, use the local installer:

```bash
bun run setup:cloudflare
```

It will:

- open a prefilled Cloudflare API token page for `Workers Scripts`, `Workers KV Storage`, and `D1`
- prompt for your Cloudflare account ID and API token
- optionally prompt for your ElevenLabs API key and voice ID
- create or reuse the required KV namespaces and D1 database
- create a `workers.dev` subdomain if the account does not have one yet
- generate a local Wrangler config under `.dev/cloudflare/`
- apply the D1 migration, deploy the Worker, and set Worker secrets
- write local listener settings like `AMPLINK_CONTROL_BASE_URL` and `AMPLINK_DESKTOP_LISTENER_TOKEN` into [`.env.local`](/Users/arach/dev/amplink/.env.local)

Notes:

- The Cloudflare API token is used locally during setup and is not written back to [`.env.local`](/Users/arach/dev/amplink/.env.local) by the installer.
- `bun run setup:cloudflare` ignores the generic `CLOUDFLARE_API_TOKEN` on purpose. If you want to preseed setup without a prompt, use `AMPLINK_CLOUDFLARE_SETUP_TOKEN` instead.
- The installer starts with an account-token template URL and only offers a user-token fallback if account-token creation is not possible. Account tokens require Administrator or Super Administrator access in Cloudflare.
- Before creating the token, confirm the page includes `Account -> Workers Scripts -> Edit`, `Account -> Workers KV Storage -> Edit`, and `Account -> D1 -> Edit`. If Cloudflare drops one from the template, add it manually.

### Deploy

1. Create a D1 database named `amplink_db`, a KV namespace for desktop registrations, and a KV namespace for voice profiles, then replace the IDs in [wrangler.toml](/Users/arach/dev/amplink/wrangler.toml).
2. Set the ElevenLabs secret with `bunx wrangler secret put ELEVENLABS_API_KEY`.
3. Set `DESKTOP_LISTENER_TOKEN` with `bunx wrangler secret put DESKTOP_LISTENER_TOKEN` for the outbound desktop listener.
4. Optionally set `CONTROL_SHARED_SECRET` if you want `/control/*` registration and legacy HTTP desktop dispatch calls to require a bearer token.
5. Generate Cloudflare types with `bun run cf:types`.
6. Apply the D1 migration with `bun run scripts/run-wrangler.ts d1 migrations apply amplink_db`.
7. Run local dev with `bun run cf:dev` or deploy with `bun run cf:deploy`.

The Cloudflare scripts now load both [`/Users/arach/.env.local`](/Users/arach/.env.local) and [`.env.local`](/Users/arach/dev/amplink/.env.local) automatically, so `CLOUDFLARE_API_TOKEN` does not need to be manually exported first.

### Test

Use a simple user identifier header until auth is wired in:

```bash
curl -X POST http://127.0.0.1:8787/start-session \
  -H "Content-Type: application/json" \
  -H "X-Amplink-User: demo-user" \
  -d '{"title":"Demo voice session"}'
```

Start the desktop listener if you want the Worker to forward heavy tasks through the persistent control socket:

```bash
bun run desktop:listen
```

If you want the local bridge and the desktop listener together in one terminal, use:

```bash
bun run desktop:up
```

Then connect a WebSocket client to the returned `websocketUrl` and send either a raw text string or a JSON envelope such as:

```json
{
  "type": "voice.input",
  "text": "Open the relay logs and summarize the last failure"
}
```

The Durable Object will generate a quick voice reply with Workers AI, synthesize it through ElevenLabs when configured, and forward heavy tasks to the connected desktop listener over the control WebSocket.

### Voice admin

Open the built-in control panel at:

```text
https://amplink.arach.workers.dev/admin
```

It edits a live per-user voice profile with:

- ElevenLabs `voiceId`
- `speechRate` for faster or slower spoken delivery
- `persona` (`operator`, `warm`, `dry`, `roast`)
- `roastFrequency`
- `ttsMode` (`both`, `ack`, `result`, `off`)
- optional custom style instructions

The profile is stored in KV and applied on the next voice turn without rebuilding the iPhone app.

If `CONTROL_SHARED_SECRET` is set in Cloudflare, open the admin with:

```text
https://amplink.arach.workers.dev/admin?token=YOUR_SECRET
```

### Live smoke

Run a deployed end-to-end smoke test against the Worker:

```bash
bun run smoke:cloudflare
```

Defaults:

- `AMPLINK_SMOKE_BASE_URL=https://amplink.arach.workers.dev`
- `AMPLINK_SMOKE_REQUIRE_TTS=1`
- `AMPLINK_SMOKE_TEXT="hello from the live smoke test"`

Useful overrides:

```bash
AMPLINK_SMOKE_TEXT="open the relay logs" bun run smoke:cloudflare
AMPLINK_SMOKE_REQUIRE_TTS=0 bun run smoke:cloudflare
AMPLINK_SMOKE_BASE_URL="http://127.0.0.1:8787" bun run smoke:cloudflare
```

### Desktop listener

The default desktop path is now one outbound WebSocket from your machine to Cloudflare. The listener script lives at [desktop-listener.ts](/Users/arach/dev/amplink/desktop-listener.ts) and proxies each incoming task into the local Amplink bridge on `ws://127.0.0.1:17888` by using the normal `session/list`, `prompt/send`, and `session/snapshot` RPC flow.

Run it like this:

```bash
bun run desktop:listen
```

`desktop-listener.ts` loads [`.env.local`](/Users/arach/dev/amplink/.env.local) automatically. The current local file already stores `AMPLINK_CONTROL_BASE_URL`, `AMPLINK_DESKTOP_LISTENER_TOKEN`, and `AMPLINK_BRIDGE_URL`, so the Bun script is the only command you need.

The combined `desktop:up` command uses that same `AMPLINK_BRIDGE_URL` and starts the bridge on its port. The current local default is `ws://127.0.0.1:17888` to stay out of the way of anything already using `7888`.

Current listener behavior:

- reconnects every 3 seconds if the Cloudflare socket closes
- sends a `listener.hello` handshake on connect
- expects exactly one active local bridge session unless the task includes an explicit target session
- sends back `task.result` with `{ sessionId, result, status }` on the same WebSocket

The old `POST /dispatch` bridge endpoint is still available as a fallback path, but it is no longer the primary setup.
