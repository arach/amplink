# Amplink Wire Protocol

Canonical reference for the Amplink wire protocol. All clients and adapters must conform to this document. When this document and the iOS guide or any other doc disagree, this document wins.

Source of truth: `src/protocol/primitives.ts`, `src/bridge/server.ts`, `src/bridge/state.ts`, `src/bridge/buffer.ts`, `src/security/transport.ts`.

## 1. Transport

WebSocket (RFC 6455). All messages are UTF-8 JSON strings.

### Encrypted mode (required for iOS clients)

Every WebSocket message is a JSON envelope:

```
{ "phase": "handshake", "payload": "<base64>" }
{ "phase": "transport", "payload": "<base64>" }
```

- `handshake`: Noise protocol message bytes, base64-encoded.
- `transport`: AES-256-GCM ciphertext, base64-encoded. Decrypt → UTF-8 JSON string containing either an RPC message or a sequenced event.

### Connection via relay

```
ws://<relay>?room=<ROOM_ID>&role=client
```

The relay forwards bytes verbatim between `bridge` and `client` roles within a room. It never inspects payloads.

### QR pairing payload

Encoded as a JSON string in the QR code:

```json
{
  "v": 1,
  "relay": "ws://host:port",
  "room": "uuid",
  "publicKey": "hex-64-chars",
  "expiresAt": 1711648000000
}
```

| Field | Type | Constraint |
|---|---|---|
| `v` | number | Must be `1`. Reject unknown versions. |
| `relay` | string | WebSocket URL |
| `room` | string | UUID |
| `publicKey` | string | 64 hex chars (32 bytes, bridge's X25519 static public key) |
| `expiresAt` | number | Unix ms. Reject if `Date.now() > expiresAt`. |

### Room resolution (reconnect after bridge restart)

Bridge rooms are ephemeral — a new room ID is generated each time the bridge starts. The phone resolves the current room using the bridge's permanent public key.

```
POST /resolve
Content-Type: application/json

{ "bridgePublicKey": "hex-64-chars" }
```

**200 OK**: `{ "room": "uuid" }` — bridge is connected, use this room.
**404 Not Found**: `{ "error": "bridge not found" }` — bridge is offline or not registered.

The bridge registers its public key with the relay on every connect (via `?key=` query param on the WebSocket upgrade). The relay maintains a `bridgePublicKey → roomId` index in memory.

## 2. Encryption

Cipher suite: `Noise_XX_25519_AESGCM_SHA256` (pairing) and `Noise_IK_25519_AESGCM_SHA256` (reconnect).

- Phone is always the **initiator**.
- Bridge is always the **responder**.
- XX pattern (3 messages): first-time pairing, mutual authentication.
- IK pattern (2 messages): reconnect when the phone already has the bridge's static public key.

### Nonce construction (12 bytes)

```
bytes 0-3:  0x00 0x00 0x00 0x00
bytes 4-11: counter as little-endian uint64
```

Counter starts at 0, increments per encrypt/decrypt call. Per-direction (separate counters for send and receive).

### Post-handshake

`Split()` produces two `CipherState`s. `c1` = initiator→responder, `c2` = responder→initiator. The phone sends with `c1`, decrypts with `c2`.

## 3. RPC (Phone → Bridge)

JSON-RPC-style requests. Every request has `id` (string UUID), `method`, and optional `params`. Note: the bridge does not emit or require a `jsonrpc` field — this is a simplified JSON-RPC dialect, not strict 2.0 conformance.

### Methods

| Method | Params | Result |
|---|---|---|
| `session/create` | `{ adapterType: string, name?: string, cwd?: string, options?: Record<string, unknown> }` | `Session` object |
| `session/list` | (none) | `Session[]` |
| `session/close` | `{ sessionId: string }` | `{ ok: true }` |
| `session/snapshot` | `{ sessionId: string }` | `SessionState` (full accumulated state) |
| `prompt/send` | `{ sessionId: string, text: string, files?: string[], images?: Array<{ mimeType: string, data: string }>, providerOptions?: Record<string, unknown> }` | `{ ok: true }` |
| `turn/interrupt` | `{ sessionId: string }` | `{ ok: true }` |
| `sync/replay` | `{ lastSeq: number }` | `{ events: SequencedEvent[] }` |
| `sync/status` | (none) | `{ currentSeq: number, oldestBufferedSeq: number, sessionCount: number }` |
| `bridge/status` | (none) | `{ sessions: SessionSummary[] }` |
| `workspace/info` | (none) | `{ configured: boolean, root?: string }` |
| `workspace/list` | `{ path?: string }` | `{ root: string, path: string, entries: DirectoryEntry[] }` |
| `workspace/open` | `{ path: string, adapter?: string, name?: string }` | `Session` object |
| `action/decide` | `{ sessionId: string, turnId: string, blockId: string, version: number, decision: "approve" \| "deny", reason?: string }` | `{ ok: true }` or error if version is stale |

### Error responses

```json
{ "id": "...", "error": { "code": -32601, "message": "Unknown method: foo" } }
```

Standard JSON-RPC error codes: `-32700` (parse error), `-32601` (method not found), `-32001` (not found), `-32000` (internal), `-32010` (stale approval version).

## 4. Events (Bridge → Phone)

Every event is wrapped with a monotonic sequence number:

```json
{ "seq": 47, "event": { "event": "<discriminator>", ... } }
```

`seq` starts at 1, never resets, never skips. Initial session pushes on connect use `seq: 0` (not part of the replay buffer).

### Event discriminators

| Discriminator | Payload fields | Meaning |
|---|---|---|
| `session:update` | `session: Session` | Session metadata changed |
| `session:closed` | `sessionId: string` | Session removed |
| `turn:start` | `sessionId: string, turn: Turn` | New turn began |
| `turn:end` | `sessionId: string, turnId: string, status: TurnStatus` | Turn reached terminal state |
| `turn:error` | `sessionId: string, turnId: string, message: string` | Turn-level error |
| `block:start` | `sessionId: string, turnId: string, block: Block` | New block within a turn |
| `block:delta` | `sessionId: string, turnId: string, blockId: string, text: string` | Append text to text/reasoning block |
| `block:action:output` | `sessionId: string, turnId: string, blockId: string, output: string` | Append output to action block |
| `block:action:status` | `sessionId: string, turnId: string, blockId: string, status: ActionStatus, meta?: Record<string, unknown>` | Action status transition |
| `block:action:approval` | `sessionId: string, turnId: string, blockId: string, approval: { version: number, description?: string, risk?: "low" \| "medium" \| "high" }` | Action awaiting approval — phone renders approve/deny UI |
| `block:end` | `sessionId: string, turnId: string, blockId: string, status: BlockStatus` | Block reached terminal state |

### Reconnect / replay

1. Phone tracks `lastAppliedSeq` locally.
2. On reconnect, call `sync/status` to get `currentSeq` and `oldestBufferedSeq`.
3. If `lastAppliedSeq >= oldestBufferedSeq`: call `sync/replay` with `lastSeq: lastAppliedSeq` to get missed events.
4. If `lastAppliedSeq < oldestBufferedSeq` (gap too large): call `session/snapshot` for each session to get full state.

## 5. Primitives

### Session

```
id:           string (UUID)
name:         string
adapterType:  string ("claude-code" | "openai" | ...)
status:       "connecting" | "active" | "idle" | "error" | "closed"
cwd?:         string
model?:       string
providerMeta?: Record<string, unknown>
```

### Turn

```
id:           string (UUID)
sessionId:    string
status:       "started" | "streaming" | "completed" | "failed" | "stopped"
startedAt:    string (ISO-8601)
endedAt?:     string (ISO-8601)
blocks:       Block[]
```

### Block

Discriminated union on `type`:

```
Common fields:
  id:       string (UUID)
  turnId:   string
  status:   "started" | "streaming" | "completed" | "failed"
  index:    number (monotonic within turn, for stable ordering)

type: "text"
  text:     string

type: "reasoning"
  text:     string

type: "action"
  action:   Action

type: "file"
  mimeType: string
  name?:    string
  data:     string (base64 or URI)

type: "error"
  message:  string
  code?:    string
```

### Action

Discriminated union on `kind`:

```
Common fields:
  status:   "pending" | "running" | "completed" | "failed" | "awaiting_approval"
  output:   string
  approval?: { version: number, description?: string, risk?: "low" | "medium" | "high" }

kind: "file_change"
  path:     string
  diff?:    string

kind: "command"
  command:  string
  exitCode?: number

kind: "tool_call"
  toolName:   string
  toolCallId: string
  input?:     unknown
  result?:    unknown

kind: "subagent"
  agentId:    string
  agentName?: string
  prompt?:    string
```

### SessionState (snapshot response)

```
session:        Session
turns:          TurnState[]
currentTurnId?: string
```

Where `TurnState`:
```
id:       string
status:   "streaming" | "completed" | "interrupted" | "error"
blocks:   Array<{ block: Block, status: "streaming" | "completed" }>
startedAt: number (epoch ms)
endedAt?:  number (epoch ms)
```

### SessionSummary (bridge/status response)

```
sessionId:          string
name:               string
adapterType:        string
status:             string
turnCount:          number
currentTurnStatus?: string
startedAt:          number (epoch ms)
lastActivityAt:     number (epoch ms)
```

### DirectoryEntry (workspace/list response)

```
name:            string (directory name)
path:            string (absolute path)
hasGit:          boolean
hasPackageJson:  boolean
```

### SequencedEvent (replay response)

```
seq:       number
event:     AmplinkEvent
timestamp: number (epoch ms)
```
