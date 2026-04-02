import { createAdapter as createClaudeCode } from "../adapters/claude-code.ts";
import { createAdapter as createOpenAI } from "../adapters/openai-compat.ts";
import { createAdapter as createCodex } from "../adapters/codex.ts";
import { createAdapter as createPi } from "../adapters/pi.ts";
import { createAdapter as createOpenCode } from "../adapters/opencode.ts";
import type { AdapterFactory } from "../protocol/index.ts";
import type { AdapterEntry } from "./config.ts";

const BUILT_IN_ADAPTERS: Record<string, AdapterFactory> = {
  "claude-code": createClaudeCode,
  "codex": createCodex,
  "pi": createPi,
  "opencode": createOpenCode,
  "openai": createOpenAI,
};

export function createAdapterRegistry(
  configAdapters?: Record<string, AdapterEntry>,
): Record<string, AdapterFactory> {
  const adapters: Record<string, AdapterFactory> = { ...BUILT_IN_ADAPTERS };

  if (!configAdapters) {
    return adapters;
  }

  for (const [name, entry] of Object.entries(configAdapters)) {
    const baseFactory = adapters[entry.type];
    if (!baseFactory) {
      console.warn(`[bridge] config adapter "${name}" references unknown type "${entry.type}" — skipped`);
      continue;
    }

    adapters[name] = (adapterConfig) => {
      const merged = {
        ...adapterConfig,
        options: { ...entry.options, ...adapterConfig.options },
      };
      return baseFactory(merged);
    };
  }

  return adapters;
}
