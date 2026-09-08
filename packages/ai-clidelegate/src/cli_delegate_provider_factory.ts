/**
 * @module CliDelegateProviderFactory
 * @path packages/ai-clidelegate/src/cli_delegate_provider_factory.ts
 * @description Factory for creating CliDelegateModelProvider instances from resolved
 *   provider options. No API key required (AbstractProviderFactory, not the key-based
 *   variant) — auth is a subscription login the spawned CLI resolves on its own.
 * @architectural-layer AI
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 */

import { AbstractProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import { CliDelegateModelProvider } from "./cli_delegate_model_provider.ts";
import {
  DEFAULT_CLAUDE_CLI_BIN,
  DEFAULT_CLAUDE_CLI_MODEL,
  DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
  DEFAULT_CODEX_CLI_BIN,
  DEFAULT_CODEX_CLI_MODEL,
  DEFAULT_OPENCODE_CLI_BIN,
  DEFAULT_OPENCODE_CLI_MODEL,
} from "./constants.ts";

/** Per-tool bin/default-model pair `create()` selects between. cursor/vscode are
 * interactive-launch tools (SessionAdapterRegistry) never routed through this factory,
 * so they fall back to opencode's defaults below. */
const BIN_AND_MODEL_BY_TOOL: Partial<Record<SessionTool, { bin: string; defaultModel: string }>> = {
  [SessionToolSchema.enum["claude-code"]]: { bin: DEFAULT_CLAUDE_CLI_BIN, defaultModel: DEFAULT_CLAUDE_CLI_MODEL },
  [SessionToolSchema.enum.opencode]: { bin: DEFAULT_OPENCODE_CLI_BIN, defaultModel: DEFAULT_OPENCODE_CLI_MODEL },
  [SessionToolSchema.enum.codex]: { bin: DEFAULT_CODEX_CLI_BIN, defaultModel: DEFAULT_CODEX_CLI_MODEL },
};
const OPENCODE_FALLBACK = { bin: DEFAULT_OPENCODE_CLI_BIN, defaultModel: DEFAULT_OPENCODE_CLI_MODEL };

// options.model may arrive "provider:model"-prefixed (ModelResolver/EXA_LLM_MODEL convention,
// see session_adapter_registry.ts's identical helper) — claude/codex/opencode reject that
// compound form on --model with a 404 (live-verified); none of the three use colons themselves.
function stripProviderPrefix(model: string): string {
  const separatorIndex = model.indexOf(":");
  return separatorIndex === -1 ? model : model.slice(separatorIndex + 1);
}

export class CliDelegateProviderFactory extends AbstractProviderFactory {
  constructor(private readonly tool: SessionTool) {
    super();
  }

  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const { bin, defaultModel } = BIN_AND_MODEL_BY_TOOL[this.tool] ?? OPENCODE_FALLBACK;
    const model = stripProviderPrefix(options.model || defaultModel);

    return Promise.resolve(
      new CliDelegateModelProvider({
        tool: this.tool,
        bin,
        model,
        cwd: options.config?.system.root ?? Deno.cwd(),
        timeoutMs: options.timeoutMs ?? DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
        id: options.id ?? this.generateId(this.tool, model),
      }),
    );
  }
}
