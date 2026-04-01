# plexus

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Cloudflare voice backend

The repo now includes a Cloudflare Workers backend under [cloudflare/worker.ts](/Users/arach/dev/plexus/cloudflare/worker.ts) with a Durable Object per voice session in [cloudflare/plexus-session.ts](/Users/arach/dev/plexus/cloudflare/plexus-session.ts). It provides:

- `GET /sessions` to list a user's sessions from D1
- `POST /start-session` to create a new voice session
- `GET /ws?session={id}&device=mobile` to attach the mobile client to the session Durable Object
- `/control/*` routes from [cloudflare/control.ts](/Users/arach/dev/plexus/cloudflare/control.ts) to register a desktop dispatch endpoint in KV

### Deploy

1. Create a D1 database named `plexus_db` and a KV namespace for desktop registrations, then replace the placeholder IDs in [wrangler.toml](/Users/arach/dev/plexus/wrangler.toml).
2. Set the ElevenLabs secret with `bunx wrangler secret put ELEVENLABS_API_KEY`.
3. Optionally set `CONTROL_SHARED_SECRET` if you want `/control/*` registration and desktop dispatch calls to require a bearer token.
4. Generate Cloudflare types with `bun run cf:types`.
5. Apply the D1 migration with `bunx wrangler d1 migrations apply plexus_db`.
6. Run local dev with `bun run cf:dev` or deploy with `bun run cf:deploy`.

### Test

Use a simple user identifier header until auth is wired in:

```bash
curl -X POST http://127.0.0.1:8787/start-session \
  -H "Content-Type: application/json" \
  -H "X-Plexus-User: demo-user" \
  -d '{"title":"Demo voice session"}'
```

Register a desktop listener if you want the Worker to forward heavy tasks:

```bash
curl -X POST http://127.0.0.1:8787/control/register \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user","endpoint":"https://desktop.example.com/dispatch"}'
```

Then connect a WebSocket client to the returned `websocketUrl` and send either a raw text string or a JSON envelope such as:

```json
{
  "type": "voice.input",
  "text": "Open the relay logs and summarize the last failure"
}
```

The Durable Object will generate a quick voice reply with Workers AI, synthesize it through ElevenLabs when configured, and forward a desktop-ready `Prompt` payload to the registered `/dispatch` endpoint.
