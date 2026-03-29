# Proposal 003: Structured Diffs and Inline Review

**Status:** Draft
**Author:** (open for discussion)
**Inspired by:** OrbitDock's Magit-style diff viewer with inline comments and agent feedback loop

## Problem

When an AI agent edits a file, Plexus currently shows it as an action block with `kind: "file_change"`, a `path`, and an optional `diff` string. The diff is opaque text — the phone can display it, but can't do anything useful with it. No syntax highlighting by hunk, no expand/collapse, no way to comment on a specific change and send that feedback back to the agent.

This matters because code review is the highest-value interaction in AI-assisted development. The agent writes code; the human reviews it. If the review surface is "here's a wall of text," you'll go back to your laptop. If it's "tap this hunk to comment, your feedback goes straight to the agent," you stay on the phone.

## Design Principles

1. **Structured data, not rendered views.** The protocol carries structured diff data. The phone decides how to render it. Don't send ANSI-colored strings or HTML.
2. **Comments flow back through the existing prompt mechanism.** A diff comment is just a prompt with file/line context attached. No new side channel needed.
3. **Progressive enhancement.** Adapters that can only provide a raw diff string still work. The structured fields are optional additions. Phones that can't render fancy diffs fall back to displaying the raw string.

## Protocol Changes

### Enhanced `FileChangeAction`

```typescript
export interface FileChangeAction extends ActionBase {
  kind: "file_change";
  /** Absolute path of the changed file. */
  path: string;
  /** Raw unified diff string (always present if available). */
  diff?: string;

  // --- New structured fields (optional, progressive enhancement) ---

  /** The type of file change. */
  changeType?: "create" | "modify" | "delete" | "rename";
  /** Original path, if this is a rename. */
  oldPath?: string;
  /** Language identifier for syntax highlighting (e.g., "typescript", "rust"). */
  language?: string;
  /** Structured hunk data for rich diff rendering. */
  hunks?: DiffHunk[];
}
```

### New types: `DiffHunk` and `DiffLine`

```typescript
/** A contiguous region of changes within a file. */
interface DiffHunk {
  /** Hunk header (e.g., "@@ -10,5 +10,7 @@"). */
  header: string;
  /** Starting line number in the old file. */
  oldStart: number;
  /** Number of lines in the old file's side of this hunk. */
  oldCount: number;
  /** Starting line number in the new file. */
  newStart: number;
  /** Number of lines in the new file's side of this hunk. */
  newCount: number;
  /** Optional function/class context from the hunk header. */
  context?: string;
  /** Individual lines within the hunk. */
  lines: DiffLine[];
}

/** A single line within a diff hunk. */
interface DiffLine {
  /** Line type. */
  type: "context" | "add" | "remove";
  /** The line content (without the leading +/-/space). */
  content: string;
  /** Line number in the old file (present for "context" and "remove"). */
  oldLineNo?: number;
  /** Line number in the new file (present for "context" and "add"). */
  newLineNo?: number;
}
```

### Inline review: enhanced `Prompt`

No new RPC method needed. Diff comments flow through the existing `prompt/send` with additional context:

```typescript
export interface Prompt {
  sessionId: string;
  text: string;
  files?: string[];
  images?: Array<{ mimeType: string; data: string }>;
  providerOptions?: Record<string, unknown>;

  // --- New field for inline review context ---

  /** File-specific review comments. When present, the adapter should
   *  format these as contextual feedback to the agent. */
  reviewContext?: ReviewComment[];
}

interface ReviewComment {
  /** Path of the file being reviewed. */
  path: string;
  /** Starting line number in the new file. */
  startLine: number;
  /** Ending line number (same as startLine for single-line comments). */
  endLine: number;
  /** The comment text. */
  comment: string;
  /** The code being commented on (for adapter context). */
  codeSnippet?: string;
}
```

The adapter receives a prompt with `reviewContext` and formats it appropriately for the backend. For Claude Code, this might become:

```
The user has reviewed your changes and has feedback:

In `src/bridge/server.ts` (lines 45-52):
> const result = await handleRPC(bridge, req);
User comment: "This should handle the case where bridge is shutting down — add a guard."

Please address this feedback.
```

The adapter builds this string from the structured `ReviewComment[]`. The protocol doesn't prescribe the formatting — that's adapter territory.

## Adapter Implementation Notes

### Claude Code

The Claude Code adapter already maps `Edit`/`Write`/`MultiEdit` tool_use events to `file_change` actions. To produce structured hunks:

1. **From tool_use input**: The `Edit` tool provides `old_string` and `new_string`. The adapter can compute a minimal hunk from these.
2. **From tool_result**: If the tool result includes the applied diff, parse it into hunks.
3. **From git**: After the tool completes, run `git diff HEAD -- <path>` to get a precise unified diff, then parse it into `DiffHunk[]`. This is the most reliable approach.

The `language` field can be inferred from the file extension (`.ts` → `"typescript"`, `.rs` → `"rust"`).

For review comments: format the `ReviewComment[]` into a natural-language prompt and send it as the next turn. The agent sees "the user reviewed lines 45-52 of server.ts and said X" and can respond accordingly.

### OpenAI-compatible

Most chat completion APIs don't produce diffs natively. The adapter can:
- Parse diff-like content from the assistant's text response and extract hunks.
- For tool-use models that produce file edits, map the tool output to structured hunks.
- Fall back to `diff: rawString` with no `hunks` — the phone renders the raw diff.

## Phone UX (non-prescriptive)

### Diff rendering
- Hunks render as expandable/collapsible sections within the action block.
- Side-by-side or unified view, user's preference.
- Syntax highlighting based on `language` field.
- `changeType: "create"` gets a "new file" badge; `"delete"` gets a caution treatment.
- Context lines are dimmed; additions are green; removals are red.

### Inline review
- Long-press (or tap) a line/hunk to open a comment input.
- Comments attach to line ranges.
- "Send review" collects all comments into a single `prompt/send` with `reviewContext`.
- The turn that follows shows the agent responding to the review — visible in the timeline.

### Fallback
- If `hunks` is absent but `diff` is present, render the raw diff string in a monospace block.
- If neither is present, show just the file path and action status.

## Open Questions

1. **Full file content.** Should the protocol optionally carry the full new file content (not just the diff)? This would let the phone render a complete file view with changes highlighted. But it's potentially large — maybe only on explicit request via a new RPC method like `action/file-content`.
2. **Binary files.** For image diffs (e.g., an agent regenerating a PNG), should there be a binary diff representation? Or is the `FileBlock` type sufficient for that?
3. **Multi-file changes.** Some agent actions touch multiple files atomically (e.g., a refactoring). Should there be a way to group multiple `file_change` action blocks into a single reviewable changeset? Or is that a phone-side grouping concern?
4. **Review state.** Should the protocol track whether a file change has been "reviewed" vs. "pending review"? This could be useful for a review dashboard, but adds state management complexity.
5. **Hunk parsing library.** Should Plexus ship a shared `parseDiff()` utility that adapters can use? Or leave it to each adapter? A shared utility would ensure consistent `DiffHunk` output across adapters.
