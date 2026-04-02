# Amplink

Universal mobile viewport for AI coding sessions. One app, N agents, zero credentials.

## Architecture

```
Phone (renders Amplink primitives)
  ↕ encrypted WebSocket (Noise XX/IK)
Relay (forwards opaque bytes, zero-knowledge)
  ↕ WebSocket
Bridge (runs on user's machine, manages adapters)
  ├── claude-code adapter  ← stdio (reference implementation)
  ├── openai-compat adapter ← HTTPS (covers GPT, Groq, Together, LM Studio, etc.)
  └── community adapters   ← anything that emits Amplink primitives
```

## Core concepts

- **Session** — connection to one agent
- **Turn** — one request/response cycle
- **Block** — unit of content: `text`, `reasoning`, `action`, `file`, `error`
- **Delta** — streaming update to a block (`block:start` → `block:delta` → `block:end`)
- **Adapter** — maps any backend's native events to Amplink primitives

Primitives are aligned with Vercel AI SDK LanguageModelV3 content types.

## Commands

```bash
bun run bridge              # Start bridge on ws://localhost:17888
bun run relay               # Start relay on ws://localhost:7889
bun run bridge -- --port N  # Custom port
bun run typecheck           # TypeScript check
```

## Project structure

```
src/
  protocol/
    primitives.ts   — Core types (Session, Turn, Block, Delta, Prompt)
    adapter.ts      — Adapter interface + BaseAdapter helper
  bridge/
    bridge.ts       — Session manager, event router
    server.ts       — WebSocket server (JSON-RPC)
    main.ts         — Entry point
  relay/
    relay.ts        — Room-based WebSocket forwarder
    main.ts         — Entry point
  security/
    noise.ts        — Noise Protocol (XX + IK, X25519, AES-256-GCM, SHA-256)
    identity.ts     — Key persistence, trusted peers, QR payload
    transport.ts    — Encrypted WebSocket wrapper
    noise.test.ts   — Handshake + transport tests
  adapters/
    claude-code.ts  — Reference adapter (spawns claude CLI)
```

## Execution plan

See `PLAN.md` for the full implementation plan with parallel workstreams.

## Key decisions made

- **Noise Protocol Framework** over custom handshake (formally verified, auditable, same crypto primitives)
- **AI SDK V3 alignment** for block types (text, reasoning, tool-call → action, file, error)
- **FIFOs + tmux** pattern explored for stdio transport (see remodex tmux-codex-transport.js)
- **OpenAI-compat adapter** for broad provider coverage (one adapter covers dozens of backends)
- **No Ollama project dependency** — if someone wants local models, they use the OpenAI-compat adapter pointing at any local server
- **iOS client deferred** — protocol spec first, Swift implementation against stable primitives later

## Design principles

- Amplink is a viewport, not a platform — it never touches API keys or credentials
- The bridge runs on the user's machine; all sensitive data stays local
- The relay forwards opaque encrypted bytes; it can't read payloads
- Adapters are plugins; the community builds them, Amplink defines the primitive contract
- Primitives are the product — if your thing emits valid blocks, the phone renders it

## Adding an adapter

Implement the `Adapter` interface from `src/protocol/adapter.ts` or extend `BaseAdapter`. Your adapter must:
1. Translate user `Prompt` into whatever the native backend expects
2. Emit Amplink events (`turn:start`, `block:start`, `block:delta`, `block:end`, `turn:end`) as the response streams in
3. Handle `interrupt()` and `shutdown()` cleanly

Register it in `src/bridge/main.ts` and it works.

## Guardrails

- Use Bun, not Node/npm
- Keep the primitive surface small — resist adding block types unless unavoidable
- Adapters never touch networking or encryption — they only emit primitives
- The bridge/relay never touch provider credentials
- Treat this as open source: no junk code, no placeholder hacks
