# Amplink — Execution Plan

You are building something that doesn't exist yet. A universal, encrypted, local-first mobile viewport into every AI coding session a developer runs. One app on their phone. Every agent they use. Zero credentials touching your infrastructure. The primitives are the product — get them right and an entire ecosystem builds itself on top.

This is not a wrapper. This is not a SaaS. This is an open protocol with a reference implementation that respects the developer's machine as the source of truth. You hold nothing. You see nothing. You render everything.

## What's Built (Read the Code — It's Clean)

The foundation is solid and tested. Here's what exists at `src/`:

### Protocol Layer (`src/protocol/`)
- **Primitives** (`primitives.ts`): Session, Turn, Block, Delta, Prompt. Five block types: `text`, `reasoning`, `action`, `file`, `error`. Four action kinds: `file_change`, `command`, `tool_call`, `subagent`. Aligned with Vercel AI SDK LanguageModelV3 content types. This is the universal vocabulary.
- **Adapter interface** (`adapter.ts`): `start()`, `send(prompt)`, `interrupt()`, `shutdown()` + event emitters. `BaseAdapter` handles boilerplate. Any backend implements this, emits Amplink events, and the phone renders it. That's the whole contract.

### Bridge (`src/bridge/`)
- **Bridge** (`bridge.ts`): Session manager. Creates adapter instances, routes events, manages lifecycle.
- **Server** (`server.ts`): WebSocket server with JSON-RPC dispatch. Five methods: `session/create`, `session/list`, `session/close`, `prompt/send`, `turn/interrupt`.
- **Entry point** (`main.ts`): `bun run bridge` starts on ws://localhost:17888.

### Relay (`src/relay/`)
- **Relay** (`relay.ts`): Room-based WebSocket forwarder. One bridge + N clients per room. 30s grace on bridge disconnect. Forwards everything verbatim — it never reads payloads.
- **Entry point** (`main.ts`): `bun run relay` starts on ws://localhost:7889.

### Security (`src/security/`)
- **Noise Protocol** (`noise.ts`): Full Noise Framework implementation. CipherState (AES-256-GCM + nonce), SymmetricState (HKDF-SHA256 chaining), HandshakeState (pattern execution). Two patterns:
  - **XX** (`Noise_XX_25519_AESGCM_SHA256`): 3-message mutual auth for QR pairing
  - **IK** (`Noise_IK_25519_AESGCM_SHA256`): 2-message trusted reconnect
- **Identity** (`identity.ts`): Key persistence at `~/.amplink/identity.json`, trusted peer registry, QR payload generation.
- **Transport** (`transport.ts`): `SecureTransport` wraps any WebSocket. Runs Noise handshake automatically, then encrypts/decrypts transparently. JSON envelope wire format.
- **Tests** (`noise.test.ts`): XX handshake, IK handshake, replay protection — all passing.

### Adapters (`src/adapters/`)
- **Claude Code** (`claude-code.ts`): Reference adapter. Spawns `claude --output-format stream-json`, maps assistant text → `text` blocks, thinking → `reasoning` blocks, Edit/Write → `file_change` actions, Bash → `command` actions, Agent → `subagent` actions.

### Dependencies
- **Runtime**: Bun (not Node)
- **Crypto**: `@noble/curves` (X25519), `@noble/hashes` (SHA-256, HKDF), `@noble/ciphers` (AES-256-GCM) — audited, zero-dep, pure JS
- **That's it.** No frameworks. No bloat.

## What Needs to Be Built — The Waves

### Wave 1: Four Parallel Workstreams (No Dependencies Between Them)

Each agent works in an isolated git worktree. Each owns specific files. They don't touch each other's code.

#### Agent A: Encryption Integration
**Files**: `src/bridge/server.ts` (modify), `src/bridge/relay-client.ts` (new)

The `SecureTransport` exists but isn't wired in. Do this:
1. Modify `server.ts` so incoming WebSocket connections go through `SecureTransport` (XX handshake for new clients, IK for returning trusted peers — check `isTrustedPeer()`).
2. Create `relay-client.ts` — the bridge connects *outbound* to a relay as the "bridge" role. Today the bridge only listens locally. This module connects to `ws://relay:port?room=ROOM&role=bridge` and wraps it in `SecureTransport`.
3. Update `main.ts` to accept `--relay` flag that activates outbound relay connection.
4. The phone connects to the same relay room as "client" role. The relay forwards bytes. Encryption makes the relay zero-knowledge.

Key principle: the bridge should work in BOTH modes — direct local WebSocket (LAN) and relayed (remote). The transport layer handles encryption regardless.

#### Agent B: OpenAI-Compatible Adapter
**Files**: `src/adapters/openai-compat.ts` (new)

This single adapter covers anything that speaks the OpenAI chat completions streaming format: GPT, Groq, Together, LM Studio, local vLLM, Ollama, and dozens more. Massive coverage for minimal code.

1. Takes `baseUrl` and `apiKey` in adapter config options (credentials stay local on the user's machine).
2. Sends `POST /v1/chat/completions` with `stream: true`.
3. Parses SSE `data: {...}` chunks.
4. Maps `choices[0].delta.content` → `text` block deltas.
5. Maps `choices[0].delta.tool_calls` → `action` blocks (tool_call kind).
6. Maps `choices[0].delta.reasoning_content` (if present) → `reasoning` blocks.
7. Handles `[DONE]` → turn end.
8. Register in `main.ts` as `"openai"` adapter type.

Keep it lean. This adapter will be the most-used one in practice.

#### Agent C: Reconnect + Buffer Layer
**Files**: `src/bridge/buffer.ts` (new)

Without this, a dropped connection means lost events. Build:
1. `OutboundBuffer` class — ring buffer of the last 500 Amplink events, each tagged with a monotonic sequence number.
2. When a client connects/reconnects, it sends its `lastSeq` number.
3. Bridge replays all buffered events after `lastSeq`.
4. Client tracks `lastAppliedSeq` to prevent duplicates.
5. Wire into `bridge.ts` — the `onEvent` broadcast path should go through the buffer.

Follow the same pattern as remodex's `bridgeOutboundSeq` / `SecureResumeState` (see `/Users/arach/dev/ext/remodex/phodex-bridge/src/secure-transport.js` lines 102-125 for reference).

#### Agent D: Snapshot Endpoint
**Files**: `src/bridge/server.ts` (add RPC method)

The phone needs to recover full state after a reconnect, not just replay deltas. Add:
1. `session/snapshot` RPC method — returns the full current state of a session (session metadata + all turns + all blocks).
2. `bridge/list` RPC method — returns all sessions with their current status (for the phone's dashboard view).
3. The bridge maintains in-memory state for each session's turns/blocks (fed by adapter events).

This is the "pull" complement to the "push" event stream. Deltas for real-time, snapshots for recovery.

### Wave 2: Two Workstreams (Depend on Wave 1)

#### Agent E: CLI + Config
**Files**: `src/bridge/main.ts` (enhance), `src/bridge/config.ts` (new)

Make the bridge actually pleasant to use from a terminal:
1. Config file at `~/.amplink/config.json` — relay URL, default adapters, adapter-specific options.
2. Terminal QR code display — when pairing, render the QR payload as ASCII art in the terminal (use a small QR library or `qrcode-terminal`). This is the magic moment: run the bridge, scan the QR, you're in.
3. Subcommands: `amplink-bridge start` (default), `amplink-bridge pair` (show QR), `amplink-bridge status` (list sessions).
4. Auto-register adapters from config — user adds an entry, bridge loads it on start.

#### Agent F: Integration Tests
**Files**: `src/**/*.test.ts`

End-to-end proof that the whole pipeline works:
1. Spawn relay in-process.
2. Spawn bridge connected to relay.
3. Create a session with a mock adapter (not Claude Code — a simple echo adapter for testing).
4. Simulate a phone client connecting to relay, completing XX handshake.
5. Send a prompt, verify encrypted Amplink events arrive at the phone.
6. Test reconnect: disconnect phone, reconnect, verify buffer replay.
7. Test IK: disconnect, reconnect with known key, verify 2-message handshake.

### Wave 3: Documentation

#### Agent G: Protocol Spec
**Files**: `PROTOCOL.md` (new)

The publishable spec. This is what adapter authors read, what the Swift client implements against, what the community uses:
1. Wire format (JSON-RPC + JSON envelopes for encrypted transport).
2. Handshake flow (Noise XX for pairing, Noise IK for reconnect).
3. Block types and their schemas.
4. Delta lifecycle (block:start → block:delta → block:end).
5. Turn lifecycle (turn:start → deltas → turn:end).
6. Session lifecycle.
7. Adapter contract.
8. Relay protocol (room-based forwarding).
9. QR payload format.
10. Sequence numbers and reconnect/replay semantics.

## Design Philosophy — Burn This Into Your Context

1. **Amplink is a viewport, not a platform.** It never touches API keys, credentials, or provider accounts. The bridge runs on the user's machine. Their secrets stay on their hardware.

2. **The relay is zero-knowledge.** It forwards opaque encrypted bytes. It cannot read payloads. When someone asks "is my data safe?" the answer is: even if the relay is compromised, the attacker gets ciphertext.

3. **Primitives are the product.** If your thing emits valid Amplink blocks over the wire format, the phone app renders it. You define the vocabulary, the community builds the adapters. Like LSP for AI session observability.

4. **Adapters are someone else's problem — and that's a feature.** You ship the reference Claude Code adapter and the OpenAI-compat adapter. Everything else is community-contributed. Browser extensions, custom integrations, proprietary tools — they all just need to emit blocks.

5. **No junk code.** This is open source. Every file should be something you'd be proud to show. No placeholder hacks, no TODO comments that linger, no "we'll clean this up later."

6. **Bun, not Node.** TypeScript throughout. `@noble/*` for crypto. Minimal dependencies. If Bun provides it built-in, use it.

## Now Go Build It

You have a clean foundation, a clear plan, and parallel workstreams that don't block each other. The Noise handshake is proven. The primitives are typed. The bridge starts clean. The relay forwards bytes.

Wave 1 is four agents, four worktrees, zero conflicts. Fire them all at once. When they land, Wave 2 makes it usable and tested. Wave 3 makes it publishable.

The result is an open protocol that lets any developer see all their AI sessions from their phone, encrypted end-to-end, with zero credentials leaving their machine. Nobody else is building this. Ship it.
