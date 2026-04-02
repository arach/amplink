# amplink

Universal mobile viewport for AI coding sessions. One phone, N agents, zero credentials.

## What is Amplink?

Amplink turns your phone into a live viewport for AI coding sessions running on your machine. You see streaming agent output on the phone — text, reasoning, tool calls, file diffs — while API keys and credentials never leave your desktop.

It works with multiple backends through a small adapter layer:

- **claude-code** — persistent Claude Code sessions
- **codex** — Codex-backed sessions
- **openai** — any OpenAI-compatible endpoint (GPT, Groq, Together, LM Studio, local models)
- **opencode**, **pi** — additional local agent backends
- **community adapters** — anything that emits Amplink primitives

## How it works

```
Phone (renders Amplink primitives)
  ↕ encrypted WebSocket
Relay / Cloudflare Worker (forwards opaque bytes, zero-knowledge)
  ↕ WebSocket
Bridge (runs on your machine, manages adapters)
  ├── claude-code adapter
  ├── codex adapter
  ├── openai-compat adapter
  └── community adapters
```

The **bridge** is the local orchestrator — it creates sessions, routes prompts, and buffers events. The **relay** forwards encrypted bytes without inspecting them. **Adapters** translate each backend's native events into a small set of primitives the phone renders.

Core primitives: **Session**, **Turn**, **Block** (text, reasoning, action, file, error), **Delta** (streaming updates).

## Quick start

```bash
git clone https://github.com/arach/amplink.git
cd amplink
bun install
```

### Recommended: Cloudflare desktop flow

```bash
# 1. Initialize local config (generates identity, sets workspace defaults)
bun run amplink init

# 2. Provision the Cloudflare worker, KV namespaces, and D1 database
bun run setup:cloudflare

# 3. Start the local bridge + desktop listener
bun run desktop:up

# 4. Show a QR code to pair your phone
bun run amplink pair
```

### Low-level bridge/relay flow (for protocol work)

```bash
bun run bridge              # Start bridge on ws://localhost:17888
bun run relay               # Start relay on ws://localhost:7889
bun run bridge -- --port N  # Custom bridge port
```

### CLI reference

```bash
bun run amplink --help      # Full command list
bun run amplink status      # Show config, relay URL, active sessions
bun run amplink config      # View or update config values
bun run amplink workspace   # Browse projects in workspace root
```

## Documentation

Detailed guides live in [`docs/`](./docs/README.md):

| Guide | What it covers |
|-------|---------------|
| [Overview](./docs/overview.md) | Product model, key concepts, system shape |
| [Getting Started](./docs/getting-started.md) | Step-by-step setup for both desktop and bridge/relay flows |
| [Architecture](./docs/architecture.md) | Repo structure, component boundaries, runtime flows |
| [Protocol](./docs/protocol.md) | Wire protocol, transport, pairing, RPC surface, event stream |
| [Cloudflare](./docs/cloudflare.md) | Worker setup, voice routes, admin UI, smoke testing |
| [iOS Client](./docs/ios.md) | Pairing, reconnect, timeline rendering |

## Cloudflare voice backend

The optional Cloudflare Workers backend adds voice interaction and a hosted relay. The worker lives in [`cloudflare/`](./cloudflare/) and provides:

| Route | Purpose |
|-------|---------|
| `POST /start-session` | Create a new voice session |
| `GET /sessions` | List a user's sessions from D1 |
| `GET /ws?session={id}&device=mobile` | Attach the mobile client to a session |
| `GET /listen?token={token}` | Attach the desktop listener over WebSocket |
| `GET /admin` | Built-in voice admin web UI |
| `GET/PUT /api/voice-profile` | Read or update the live per-user voice profile |
| `POST /api/voice-preview` | Preview current voice/personality before saving |
| `/control/*` | Legacy desktop endpoint registration in KV |

### BYO Cloudflare setup

To deploy into your own Cloudflare account:

```bash
bun run setup:cloudflare
```

The installer will:

- Open a prefilled Cloudflare API token page for `Workers Scripts`, `Workers KV Storage`, and `D1`
- Prompt for your Cloudflare account ID and API token
- Optionally prompt for your ElevenLabs API key and voice ID
- Create or reuse required KV namespaces and D1 database
- Create a `workers.dev` subdomain if the account doesn't have one
- Generate a local Wrangler config under `.dev/cloudflare/`
- Apply the D1 migration, deploy the Worker, and set Worker secrets
- Write local listener settings into `.env.local`

**Notes:**

- The Cloudflare API token is used locally during setup and is **not** written to `.env.local`.
- The installer ignores the generic `CLOUDFLARE_API_TOKEN` env var. To preseed setup without a prompt, use `AMPLINK_CLOUDFLARE_SETUP_TOKEN` instead.
- Account tokens require Administrator or Super Administrator access in Cloudflare. The installer offers a user-token fallback if account-token creation is not possible.
- Before creating the token, confirm the page includes `Account -> Workers Scripts -> Edit`, `Account -> Workers KV Storage -> Edit`, and `Account -> D1 -> Edit`. If Cloudflare drops one from the template, add it manually.

### Manual deploy (alternative)

If you prefer to set things up manually instead of using `bun run setup:cloudflare`:

1. Create a D1 database named `amplink_db`, a KV namespace for desktop registrations, and a KV namespace for voice profiles. Replace the IDs in [`wrangler.toml`](./wrangler.toml).
2. Set `ELEVENLABS_API_KEY` with `bunx wrangler secret put ELEVENLABS_API_KEY`.
3. Set `DESKTOP_LISTENER_TOKEN` with `bunx wrangler secret put DESKTOP_LISTENER_TOKEN`.
4. Optionally set `CONTROL_SHARED_SECRET` if you want `/control/*` routes to require a bearer token.
5. Generate Cloudflare types with `bun run cf:types`.
6. Apply the D1 migration with `bun run scripts/run-wrangler.ts d1 migrations apply amplink_db`.
7. Run local dev with `bun run cf:dev` or deploy with `bun run cf:deploy`.

### Desktop listener

The desktop listener ([`desktop-listener.ts`](./desktop-listener.ts)) opens one outbound WebSocket from your machine to the Cloudflare Worker, proxying incoming tasks into the local bridge via `session/list`, `prompt/send`, and `session/snapshot` RPC.

```bash
bun run desktop:listen        # listener only
bun run desktop:up            # bridge + listener together
```

The listener loads `.env.local` automatically (expects `AMPLINK_CONTROL_BASE_URL`, `AMPLINK_DESKTOP_LISTENER_TOKEN`, and `AMPLINK_BRIDGE_URL`). It reconnects every 3 seconds on disconnect and sends results back on the same WebSocket.

### Voice admin

Open the built-in control panel at `https://<your-worker>.workers.dev/admin` to configure:

- ElevenLabs voice ID and speech rate
- Persona style (`operator`, `warm`, `dry`, `roast`) and roast frequency
- TTS mode (`both`, `ack`, `result`, `off`)
- Custom style instructions

The profile is stored in KV and applied on the next voice turn without rebuilding the phone app. If `CONTROL_SHARED_SECRET` is set, append `?token=YOUR_SECRET` to the admin URL.

### Smoke test

```bash
bun run smoke:cloudflare
```

Override defaults with environment variables:

```bash
AMPLINK_SMOKE_BASE_URL="http://127.0.0.1:8787" bun run smoke:cloudflare
AMPLINK_SMOKE_TEXT="open the relay logs" bun run smoke:cloudflare
AMPLINK_SMOKE_REQUIRE_TTS=0 bun run smoke:cloudflare
```

### Testing the worker locally

```bash
curl -X POST http://127.0.0.1:8787/start-session \
  -H "Content-Type: application/json" \
  -H "X-Amplink-User: demo-user" \
  -d '{"title":"Demo voice session"}'
```

Then connect a WebSocket client to the returned `websocketUrl` and send:

```json
{
  "type": "voice.input",
  "text": "Open the relay logs and summarize the last failure"
}
```

## Project structure

```
src/
  cli.ts              — CLI entry point
  protocol/           — Core types (Session, Turn, Block, Delta, Adapter)
  bridge/             — Session manager, event router, WebSocket server
  relay/              — Room-based WebSocket forwarder
  security/           — Noise Protocol (XX + IK), identity, encrypted transport
  adapters/           — claude-code, codex, echo, openai-compat, opencode, pi
  setup/              — Cloudflare provisioning
cloudflare/           — Workers backend (voice, relay, admin UI)
desktop-listener.ts   — Outbound control socket to Cloudflare
docs/                 — Detailed guides
```

## Adding an adapter

Implement the `Adapter` interface from [`src/protocol/adapter.ts`](./src/protocol/adapter.ts) or extend `BaseAdapter`. Your adapter must:

1. Translate user `Prompt` into whatever the native backend expects
2. Emit Amplink events (`turn:start`, `block:start`, `block:delta`, `block:end`, `turn:end`) as the response streams in
3. Handle `interrupt()` and `shutdown()` cleanly

Register it in [`src/bridge/main.ts`](./src/bridge/main.ts) and it works.

## Development

```bash
bun run typecheck             # Full TypeScript check
bun test                      # Run all tests
bun test cloudflare           # Cloudflare-specific tests
bun run cf:dev                # Local Cloudflare dev server
```
