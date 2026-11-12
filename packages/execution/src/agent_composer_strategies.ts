/**
 * @module AgentComposerStrategies
 * @path packages/execution/src/agent_composer_strategies.ts
 * @description Builds the cli-delegate strategy of an agent composer from the cli_delegate config block or a bound service.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 */

import type { Config } from "@exaix/schemas/config.ts";
import { CliDelegateStrategy, type IRunCliDelegateProcess } from "./strategies/cli_delegate_strategy.ts";
import type { IDogfoodContextPort, Opt, Reason } from "@exaix/core/types";
import { SessionToolSchema } from "@exaix/schemas";
import type { SessionTool } from "@exaix/schemas";
import { SESSION_BIN_CLAUDE_CODE, SESSION_BIN_CODEX, SESSION_BIN_OPENCODE } from "@exaix/core";
import { readDelegateProviderEnv } from "@exaix/session/delegate_provider_env.ts";

// unslop-ignore-next-line unused-type
/** What the cli-delegate strategy needs from the composer that builds it. */
export interface ICliDelegateWiring {
  readonly resolvePortalPath: (portalAlias: string) => string | undefined;
  readonly contextPort: Opt<IDogfoodContextPort, Reason.OptionalDependency>;
  readonly trustedAgentRoles: Opt<ReadonlySet<string>, Reason.OptionalDependency>;
}

/** Explicit binary mapping for the supported cli-delegate session tools. Anything else
 *  (cursor, vscode, a future tool) has no binary and fails preflight. */
function delegateBinary(tool: SessionTool): string | undefined {
  if (tool === SessionToolSchema.enum["claude-code"]) return SESSION_BIN_CLAUDE_CODE;
  if (tool === SessionToolSchema.enum.opencode) return SESSION_BIN_OPENCODE;
  if (tool === SessionToolSchema.enum.codex) return SESSION_BIN_CODEX;
  return undefined;
}

/** Builds CliDelegateStrategy from the [cli_delegate] config block. A bound cli-delegate service beats the block,
 *  even when `[cli_delegate].enabled` is false. Only claude-code, opencode and codex have a binary.
 *  The ToolRegistry's baseDir beats the portal's static config path. */
export function buildCliDelegateStrategy(
  cliDelegateConfig: Opt<NonNullable<Config["cli_delegate"]>, Reason.OptionalDependency>,
  cliDelegateBinding: Opt<{ tool: SessionTool; model: string }, Reason.OptionalDependency>,
  cliDelegateRun: Opt<IRunCliDelegateProcess, Reason.TestOverride>,
  binding: ICliDelegateWiring,
): CliDelegateStrategy {
  const tool = cliDelegateBinding?.tool ?? cliDelegateConfig?.tool;
  if (!tool) {
    throw new Error("cli-delegate strategy requires a tool from config.cli_delegate or a bound cli-delegate service");
  }
  const bin = cliDelegateConfig?.bin_overrides?.[0] ?? delegateBinary(tool);
  if (!bin) {
    throw new Error(`Unsupported cli-delegate tool: ${tool}`);
  }
  const providerEnv = cliDelegateConfig?.provider
    ? readDelegateProviderEnv(cliDelegateConfig.provider, tool, (name) => Deno.env.get(name))
    : undefined;
  return new CliDelegateStrategy({
    tool,
    bin,
    model: cliDelegateBinding?.model ?? cliDelegateConfig?.model,
    effort: cliDelegateConfig?.effort,
    providerEnv,
    resolvePortalPath: binding.resolvePortalPath,
    contextPort: binding.contextPort,
    trustedAgentRoles: binding.trustedAgentRoles,
    ...(cliDelegateRun ? { run: cliDelegateRun } : {}),
  });
}
