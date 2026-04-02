import { describe, expect, test } from "bun:test";
import { createAdapterRegistry } from "./adapters.ts";

describe("createAdapterRegistry", () => {
  test("includes the built-in adapters used by the bridge", () => {
    const registry = createAdapterRegistry();

    expect(Object.keys(registry)).toEqual(
      expect.arrayContaining(["claude-code", "codex", "openai", "opencode", "pi"]),
    );
  });

  test("registers config-defined adapter aliases on top of the built-ins", () => {
    const registry = createAdapterRegistry({
      "claude-worktree": {
        type: "claude-code",
        options: { model: "sonnet" },
      },
    });

    expect(registry["claude-worktree"]).toBeDefined();
    expect(registry["claude-worktree"]).not.toBe(registry["claude-code"]);
  });
});
