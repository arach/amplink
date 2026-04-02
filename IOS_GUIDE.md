# Amplink iOS — Architectural Guide

This document defines the hard boundaries for the iOS client and suggests patterns where useful. It is not an implementation spec — agents and developers have freedom inside the boundaries.

For the wire protocol, primitive schemas, RPC methods, and event discriminators, see `PROTOCOL.md`. That document is the canonical source. Do not restate wire details here; reference them.

## Required Invariants

These are non-negotiable. Violating any of them is a bug.

### Security

- **The iOS client is secure-only.** There is no plaintext mode. Every connection uses Noise encryption. There is no flag, setting, or debug option to disable this.
- Phone is always the Noise **initiator**. Bridge is always the **responder**.
- **XX** pattern for first-time QR pairing. **IK** pattern when a saved bridge public key exists.
- Static identity key persisted in Keychain (not UserDefaults, not files).
- Trusted bridge records persisted in Keychain.
- The Noise implementation must be **wire-compatible with the TypeScript bridge** (`src/security/noise.ts`). Validate against the bridge's test vectors before shipping. The cipher suite is `Noise_XX_25519_AESGCM_SHA256` / `Noise_IK_25519_AESGCM_SHA256` — no substitutions.

### Protocol Conformance

- All RPC method names, param shapes, and response shapes must match `PROTOCOL.md` exactly.
- All event discriminators must be handled or explicitly ignored. Unknown discriminators must not crash the app.
- Sequence numbers (`seq`) are per-bridge outbound stream, not per-connection. `lastAppliedSeq` must be persisted across reconnects to the same bridge (not just across backgrounding — across full app restarts for a given bridge identity).
- The reconnect contract: `sync/status` → decide between `sync/replay` and `session/snapshot`. See `PROTOCOL.md` §4 for the exact algorithm.

### QR Pairing

- Validate `v`, `expiresAt`, `publicKey` length before connecting. Reject unknown versions with an "update required" message.
- QR payload format is defined in `PROTOCOL.md` §1. Do not extend it client-side.

### Rendering Contract

- Five block types: `text`, `reasoning`, `action`, `file`, `error`. If the bridge sends a sixth, ignore it gracefully.
- Four action kinds: `file_change`, `command`, `tool_call`, `subagent`. Unknown kinds render as a generic card showing the raw `kind` string and `output`.
- Block `index` determines visual order within a turn. Not arrival order, not `id` sort — `index`.

## Suggested Patterns

These are recommendations based on what worked in remodex and what fits the Amplink model. Use your judgment.

### State Architecture

An `@Observable` singleton that owns connection state, session data, and event routing works well for this scale. Remodex's `CodexService` pattern is a reasonable starting point — but Amplink manages N sessions instead of one, so the internal structure will differ.

Consider separating connection management from session state. The connection layer handles WebSocket lifecycle, Noise handshake, and raw message dispatch. The session layer accumulates state from routed events. This separation makes reconnect logic cleaner.

### Timeline Rendering

Remodex's `TurnTimelineReducer` pipeline — filter → reorder → collapse → deduplicate → project — is effective for cleaning up streaming artifacts. With only 5 block types, the reducer will be simpler. Whether you use a dedicated reducer, a computed property, or a view model is up to you.

Streaming placeholders ("Thinking...", "Working...") on first delta, filled incrementally, finalized on `block:end` — this is a good UX pattern for streaming blocks.

### Session List as Home Screen

The first screen should show all active sessions across all connected bridges. Each entry needs: adapter type, session name, status indicator, and a preview of the latest activity. This is the main difference from remodex, which assumes a single agent.

### Workspace Discovery and Project Picker

The bridge exposes workspace browsing so the phone can add projects without CLI access. See `PROTOCOL.md` for the exact RPC schemas (`workspace/info`, `workspace/list`, `workspace/open`).

The user flow for adding a project:

1. Tap [+] on the session list
2. Phone calls `workspace/info` to check if a workspace root is configured
3. Phone calls `workspace/list` to get directories under the root — each entry includes `hasGit` and `hasPackageJson` flags for filtering/display
4. User browses (call `workspace/list` with `{ path: "subfolder" }` to go deeper)
5. User taps a project → phone calls `workspace/open` with the path and adapter choice
6. Bridge creates the session; it appears in the session list via `session:update` event

Design considerations:
- Show project-type indicators based on the `hasGit`, `hasPackageJson` flags. The bridge also detects `Package.swift`, `Cargo.toml`, `go.mod`, `pyproject.toml` — the phone could request these as additional signals in future protocol versions.
- Let the user pick the adapter type (claude-code, codex, openai) when opening a project. Default to claude-code.
- `workspace/list` only returns directories (no files), skips dotfiles and `node_modules`.
- If `workspace/info` returns `{ configured: false }`, prompt the user to set up the workspace root via the CLI (`amplink init`).

### Reconnect Strategy

The phone saves three things from the initial QR pairing:
- **Bridge public key** — permanent identity, survives bridge restarts
- **Relay URL** — stable (from config)
- **Last known room ID** — ephemeral, may be stale after bridge restart

Reconnect flow:

1. On foreground / launch: check for saved trusted bridge record.
2. Try connecting to the **last known room ID** on the saved relay URL. Attempt Noise IK.
3. If the room is gone (WebSocket close code 4004, or connection refused): **resolve the new room**.
4. POST to `https://<relay>/resolve` with `{ "bridgePublicKey": "<saved hex key>" }`.
5. If resolve returns `{ "room": "<new-room-id>" }`: save the new room ID, connect to it, Noise IK.
6. If resolve returns 404: bridge is offline. Show "Bridge unavailable" and retry periodically.
7. On handshake success: run the replay/snapshot recovery from `PROTOCOL.md` §4.
8. On repeated IK failure (3+ attempts): clear the saved record, present QR scanner.

The key insight: the QR scan is a one-time event. After that, the phone uses the bridge's public key as the permanent handle. Room IDs are ephemeral — the resolve endpoint maps the permanent key to the current room. The phone never needs to re-scan unless `~/.amplink/identity.json` is deleted on the bridge side.

The exact retry count, backoff timing, and UI treatment are implementation decisions.

### Background Notifications

When the app is backgrounded and a `turn:end` event arrives, a local notification is useful. The event carries `sessionId` and `status`, which is enough to compose a notification body.

### Crypto Implementation Notes

CryptoKit provides `Curve25519.KeyAgreement` (X25519), `AES.GCM`, `SHA256`, and `HKDF`. These are the primitives the Noise implementation needs. No third-party crypto dependencies should be required.

The Noise state machine (CipherState, SymmetricState, HandshakeState) from `src/security/noise.ts` is ~300 lines of TypeScript. The Swift port will be similar in size. **Before integrating, write tests that perform a handshake between the Swift implementation and the TypeScript bridge** (e.g., export test vectors from `noise.test.ts` or run a bridge in a test harness and handshake against it). Wire compatibility is a hard requirement — getting the nonce encoding, HKDF salt/info parameters, or DH direction wrong will produce silent failures.

### File Layout

Organize however makes sense for the team. One reasonable structure:

```
App/          — Entry point, service wiring
Models/       — Primitives, event types (generated or hand-written from PROTOCOL.md)
Security/     — Noise handshake, secure transport, identity/keychain
Views/        — Session list, timeline, block views, composer
```

Target iOS 17+ / iPadOS 17+. SwiftUI preferred. UIKit where necessary (AVFoundation for QR scanning).

## What to Learn from Remodex

Remodex (`/Users/arach/dev/ext/remodex/CodexMobile/`) is a working iOS app that solves a similar problem for a single agent. Useful reference points:

- **`CodexService+SecureTransport.swift`**: QR scan → connect → handshake → save trusted record → reconnect. The flow is right; the crypto needs to be replaced with Noise.
- **`TurnTimelineReducer.swift`**: Event projection pipeline. The pattern applies; the message types simplify.
- **`CodexService+Connection.swift`**: Reconnect failure counting, grace periods, foreground recovery. Good behavioral reference.
- **`GPTVoiceTranscriptionManager.swift`**: If voice input is needed later, this shows AVAudioEngine capture → WAV encoding → transcription.

What remodex gets wrong that Amplink should not repeat:
- No snapshot-based state recovery (replay buffer only).
- Single-agent assumption baked into the data model and UI.
- A dozen message `kind` values with special-case rendering (Amplink has 5 block types — keep it that way).
- Custom handshake protocol instead of a standard framework.
