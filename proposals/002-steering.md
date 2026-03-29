# Proposal 002: Mid-Turn Steering

**Status:** Draft
**Author:** (open for discussion)
**Inspired by:** OrbitDock's mid-turn injection and direct control capabilities

## Problem

Today, Plexus gives the phone two controls during an active turn: wait, or interrupt. There's no middle ground. But the most useful interaction is often neither — it's a nudge. "Use the existing helper instead of writing a new one." "Skip the tests for now." "That approach won't work, try X instead."

OrbitDock calls this "steering" — injecting guidance into a running session without stopping the current turn. It's the difference between a director yelling "cut!" and whispering a note to an actor mid-scene.

## Design Principles

1. **Steering is not a prompt.** A prompt starts a new turn. A steer injects context into the *current* turn. The agent may or may not act on it immediately, depending on where it is in its reasoning.
2. **Best-effort delivery.** Not all backends support mid-turn injection. The protocol defines the intent; the adapter decides what's possible. If the adapter can't steer, it should say so — not silently drop the message.
3. **Steering is visible in the timeline.** The phone should see its own steer messages in the turn's block sequence, so the user knows what they said and when.

## Protocol Changes

### New RPC method: `turn/steer`

| Method | Params | Result |
|---|---|---|
| `turn/steer` | `{ sessionId, turnId, text: string }` | `{ ok: true, delivered: boolean }` |

- `delivered: true` — the adapter accepted the steer and will attempt to inject it.
- `delivered: false` — the adapter doesn't support mid-turn steering. The phone can show "Steering not supported for this adapter" and suggest interrupting instead.

If there's no active turn (`turnId` doesn't match a streaming turn), return error `{ code: -32011, message: "No active turn" }`.

### New block type: `"steer"`

```typescript
/** User-injected guidance during an active turn. */
export interface SteerBlock extends BlockBase {
  type: "steer";
  /** The guidance text from the user. */
  text: string;
  /** Whether the adapter accepted and delivered this steer. */
  delivered: boolean;
}
```

Added to the Block union:

```typescript
export type Block = TextBlock | ReasoningBlock | ActionBlock | FileBlock | ErrorBlock | SteerBlock;
```

When the bridge processes a `turn/steer` request, it emits a `block:start` + `block:end` for a steer block immediately, so all connected clients see it in the timeline. The `delivered` field tells the UI whether it actually reached the agent.

### Adapter interface addition

```typescript
interface Adapter {
  // ... existing methods ...

  /**
   * Inject guidance into the current turn. Optional — adapters that
   * don't support mid-turn steering should not implement this.
   *
   * Returns true if the message was delivered to the agent,
   * false if delivery wasn't possible (e.g., agent is between tool calls
   * and can't receive input).
   */
  steer?(turnId: string, text: string): boolean;
}
```

## Bridge Behavior

1. Receive `turn/steer` RPC.
2. Validate that `turnId` matches the active turn for that session.
3. Check if the adapter implements `steer()`.
4. If yes: call `adapter.steer(turnId, text)`, get back `delivered: boolean`.
5. If no: `delivered = false`.
6. Emit a steer block into the turn's block sequence (so it appears in the timeline for all clients).
7. Return `{ ok: true, delivered }`.

## Adapter Implementation Notes

### Claude Code

Claude Code runs as a subprocess. Mid-turn steering options:

- **stdin injection**: If Claude Code accepts stdin during a turn, write the steer message there. This is the cleanest path but depends on Claude Code's interactive mode support.
- **Signal + follow-up**: Interrupt the current turn, then immediately send a new prompt that includes the steer context plus "continue where you left off." This is a fallback that works but loses some context.
- **`--continue` with context**: After the current turn completes, auto-send a continuation prompt that incorporates the steer. This is the gentlest but slowest.

The adapter should try the best available mechanism. If Claude Code adds native steering support (e.g., a stream-json input channel), the adapter can use that directly.

### OpenAI-compatible

For chat completions APIs, steering is harder — you can't inject into a streaming response. Options:

- **Return `delivered: false`** — honest and simple. The phone suggests interrupting instead.
- **Queue for next turn** — stash the steer and prepend it as a system message on the next prompt. Not real steering, but useful.
- **Cancel and re-request** — abort the stream, append the steer as a user message, re-call the API. Expensive but effective for long generations.

## Phone UX (non-prescriptive)

- During a streaming turn, the prompt input shows a "Steer" affordance instead of (or alongside) "Send."
- Steer blocks appear inline in the turn timeline, visually distinct from agent output (e.g., right-aligned like a chat bubble, or with a different background).
- If `delivered: false`, show a subtle indicator: "Agent couldn't receive this — consider interrupting."
- Quick-steer shortcuts: "skip tests", "use existing code", "try a different approach" as tappable chips.

## Open Questions

1. **Steer vs. prompt ambiguity.** If the user sends a steer but the turn ends before the adapter processes it, should the steer become the next prompt? Or just be recorded as undelivered?
2. **Multiple steers.** Can the user steer multiple times in one turn? Probably yes — each becomes its own block. But should there be a rate limit to avoid flooding the agent?
3. **Steer visibility to the agent.** Should the adapter expose steer messages as user messages in the agent's context? Or as system messages? This affects how strongly the agent responds to them.
4. **Steer + approval interaction.** If an action is awaiting approval and the user steers, should the steer be delivered before or after the approval is resolved? Probably after — the agent is paused during approval.
