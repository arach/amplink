# Proposal 001: Approval Primitives

**Status:** Draft
**Author:** (open for discussion)
**Inspired by:** OrbitDock's session-level approval workflow with monotonic version counter

## Problem

AI agents frequently perform actions that warrant human review before execution: destructive shell commands, file deletions, writes to sensitive paths, external API calls. Today, Plexus renders these as action blocks with `status: "running"` — the user sees what happened *after* it already happened.

The phone is the perfect approval surface. You're away from your desk, the agent wants to `rm -rf build/` — your phone buzzes, you glance, tap deny. That interaction doesn't exist yet.

## Design Principles

1. **Approval is an action-level concern, not session-level.** A turn can have multiple actions, some needing approval and some not. Lifting approval to the session or turn level would block non-sensitive actions unnecessarily.
2. **The adapter decides what needs approval, not the protocol.** Plexus defines the mechanism; each adapter decides its own policy (Claude Code might gate on tool type, an OpenAI adapter might gate on function names).
3. **Stale approvals must be harmless.** If the user's phone was offline and they approve something from 10 minutes ago after the turn has moved on, nothing should break.

## Protocol Changes

### New action status: `"awaiting_approval"`

```typescript
// In ActionBase:
status: "pending" | "running" | "completed" | "failed" | "awaiting_approval";
```

Inserted into the lifecycle between `pending` and `running`:

```
pending → awaiting_approval → running → completed/failed
pending → running → completed/failed  (no approval needed)
```

### New fields on ActionBase

```typescript
interface ActionBase {
  status: "pending" | "running" | "completed" | "failed" | "awaiting_approval";
  output: string;

  /** Present when status is "awaiting_approval". */
  approval?: {
    /** Monotonic version — incremented each time this action's approval
     *  state changes. Prevents stale phone responses from taking effect. */
    version: number;
    /** Human-readable description of what's being requested. */
    description?: string;
    /** Risk level hint for UI treatment (color, prominence). */
    risk?: "low" | "medium" | "high";
  };
}
```

### New event: `block:action:approval`

```typescript
interface BlockActionApprovalDelta {
  event: "block:action:approval";
  sessionId: string;
  turnId: string;
  blockId: string;
  approval: {
    version: number;
    description?: string;
    risk?: "low" | "medium" | "high";
  };
}
```

This fires when an action transitions to `awaiting_approval`. The phone renders approve/deny UI on the action block.

### New RPC methods

| Method | Params | Result |
|---|---|---|
| `action/decide` | `{ sessionId, turnId, blockId, version, decision: "approve" \| "deny", reason?: string }` | `{ ok: true }` or error if version is stale |

A single `action/decide` method rather than separate approve/deny — cleaner, one code path.

**Version check:** The bridge compares the incoming `version` against the action's current `approval.version`. If they don't match, return error `{ code: -32010, message: "Stale approval version" }`. The phone should re-fetch the action state and present the updated approval if needed.

### Adapter interface addition

```typescript
interface Adapter {
  // ... existing methods ...

  /**
   * Relay an approval decision to the underlying agent.
   * Called by the bridge after version validation passes.
   * Adapters that don't support approvals can ignore this.
   */
  decide?(blockId: string, decision: "approve" | "deny", reason?: string): void;
}
```

Optional method — adapters that don't gate on approvals never emit `awaiting_approval` and never receive `decide()` calls.

## Bridge Behavior

1. When the bridge receives `action/decide`, it validates the version, then calls `adapter.decide()`.
2. The adapter resumes the action (emitting `block:action:status` with `"running"`) or aborts it (emitting `block:action:status` with `"failed"` and a reason).
3. If the turn ends or is interrupted while an action is awaiting approval, the approval is implicitly cancelled — the action transitions to `"failed"` and the stale version ensures any late phone response is rejected.

## Phone UX (non-prescriptive)

- Action blocks with `awaiting_approval` render inline approve/deny buttons.
- `risk: "high"` gets a red treatment; `"low"` gets a subdued one.
- Optional push notification: "Claude wants to run `docker compose down` — approve?"
- After deciding, the buttons collapse and the action resumes streaming output.

## Claude Code Adapter Sketch

Claude Code's `--output-format stream-json` emits tool_use events before execution. The adapter can:

1. Check tool name against a configurable allow/deny list.
2. If the tool needs approval, emit `block:action:approval` and hold a Promise.
3. On `decide("approve")`, let Claude Code proceed (it's already waiting for the tool to complete).
4. On `decide("deny")`, abort the tool call and emit a synthetic error result.

The exact mechanism depends on whether Claude Code supports external tool approval gating. If not, the adapter can buffer the tool_use event and only forward it after approval. This is adapter-level complexity, not protocol-level.

## Open Questions

1. **Batch approvals.** Should there be an `action/decide-all` for "approve everything in this turn"? Or is that a phone-side UX pattern that calls `action/decide` N times?
2. **Auto-approve rules.** Should the bridge support configurable rules (e.g., "auto-approve all Read tools")? Or is that purely adapter config?
3. **Timeout.** Should approvals have an optional timeout after which they auto-deny? This prevents a turn from hanging forever if the phone is unreachable.
4. **Delegation.** In a future multi-client world, should approval state include who approved/denied? Probably yes, but that can be added later without breaking changes.
