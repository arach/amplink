# Proposal 004: Faithful Harness — Adapters as Environment Mirrors

**Status:** Accepted (core design principle)

## Insight

The adapter's job is not to abstract away the underlying tool. It's to **faithfully reproduce the exact environment that would run if you were sitting at your desk**, and pipe it to your phone.

This means:
- Same plugins/extensions
- Same project-specific config
- Same MCP servers
- Same hooks
- Same session, resumable across devices

The phone doesn't get a degraded experience. It gets the same session.

## What This Changes

### Adapter responsibility

Before: "Map native events to Amplink primitives."

After: "Discover and reproduce the project's full tool environment, maintain session continuity across devices, and map native events to Amplink primitives."

The mapping is still there, but it's the last step, not the only step.

### Project config discovery

Each adapter must understand its tool's native config:

| Tool | Config source | What matters |
|---|---|---|
| Claude Code | `.claude/`, `CLAUDE.md`, `settings.json` | MCP servers, hooks, skills, project instructions, permission mode |
| OpenCode | `.opencode/` | MCP servers, providers, agents, custom tools |
| Codex | Project config, agent config | Tools, permissions, project context |
| Pi.dev | `.pi/`, extensions config | Extensions, project-specific plugins, tool definitions |

When the bridge creates a session for a project, the adapter reads the project's native config and spawns the tool with the full environment. No `--bare`, no stripping. The user's carefully configured toolchain comes through intact.

### Session continuity

The core promise: **seamless transfer between desk, phone, and tablet.**

This requires:
1. **Session discovery** — the bridge can list existing sessions from the tool's native session store (e.g., Claude Code's `~/.claude/projects/`, OpenCode's session DB).
2. **Session resume** — the adapter picks up an existing session rather than starting fresh. You were working in the terminal, you walk away, you open the phone, same conversation continues.
3. **Session handoff** — when you return to your desk, the terminal session reflects what you did on the phone.

### Why `--bare` was wrong

`--bare` strips hooks, CLAUDE.md discovery, MCP servers, plugins, keychain reads. That's exactly the stuff that makes a project's environment unique. Running bare gives you a generic Claude — but the user configured their project with specific tools and instructions for a reason. The phone should respect that.

### Plugin/extension forwarding

Different projects have different plugins. When the bridge spawns a Claude Code session for project A, it gets project A's MCP servers and skills. When it spawns one for project B, it gets project B's. The phone shows both sessions, each with their own tool capabilities.

The phone doesn't need to know what MCP servers are running — it just sees action blocks with tool names. But the tools are there because the adapter faithfully reproduced the environment.

## Implications for the adapter interface

No protocol changes needed. The `AdapterConfig` already has `cwd` and `options`. The adapter uses `cwd` to discover native config and spawns accordingly. The change is in adapter implementation, not the contract.

What adapters should do on `start()`:
1. Read the project's native config from `cwd`
2. Discover existing sessions that could be resumed
3. Spawn the tool with the full environment (plugins, MCP, hooks, everything)
4. If an existing session is available, resume it instead of starting fresh

## Open questions

1. **Session listing RPC** — Should the bridge expose a `session/discover` method that lists resumable sessions from the native tool's session store? This would let the phone show "3 existing Claude Code sessions for this project" and let the user pick one.
2. **Config inspection** — Should the bridge expose what plugins/MCP servers are active in a session? This could power a phone UI that shows "this session has 4 MCP servers and 2 custom skills." Not critical but useful for transparency.
3. **Conflict resolution** — What happens if you're working in the terminal AND on the phone in the same session? Some tools handle concurrent access (Codex threads), others don't (Claude Code is single-process). The adapter needs to handle this gracefully.
