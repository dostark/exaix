/**
 * @module AgentStepPolicy
 * @path packages/execution/src/agent_step_policy.ts
 * @description Pure policy decisions of one composed agent step: portal and role check, strategy choice, tool scope, authorized paths, allocation hints and usage.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/tests/agent_orchestrator_test.ts]
 */

import type { Config, IPortalConfig } from "@exaix/schemas/config.ts";
import { canonicalizeToolName, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import type { PortalPermissionsService } from "@exaix/portal";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IAllocationHints } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { providerSupportsNativeConversation } from "./native_tool_turns.ts";
import { PLANNING_TOOL_CALL_OVERHEAD_TOKENS } from "@exaix/core";
import type { IPinnedSkillPrompt } from "./skill_pin_transport.ts";
import { resolveEffectiveSkillTools } from "./skill_tools_derivation.ts";
import type { IAgentComposerOptions, IAgentFileBlueprint } from "./agent_composer.ts";
import type { IComposerUsage } from "./agent_composer_audit.ts";

/** Bridges blueprint permitted_tools and allowed_paths onto per-call options.
 *  It narrows permitted_tools to the matched skills' tools that the agent role also allows. A skill can narrow, never grant.
 *  Both sides are canonicalized first. A role listing `grep_search` still matches a skill declaring `grep`. */
export function applyBlueprintToolScope(
  blueprint: IAgentFileBlueprint,
  options: IAgentExecutionOptions,
  matchedSkillTools: IAgentComposerOptions["matchedSkillTools"],
): void {
  if (options.permitted_tools !== undefined) {
    options.permitted_tools = options.permitted_tools.map(canonicalizeToolName);
  }
  if (blueprint.permitted_tools) {
    options.permitted_tools = blueprint.permitted_tools.map(canonicalizeToolName);
  }
  if (blueprint.allowed_paths) {
    options.allowed_paths = blueprint.allowed_paths;
  }
  if (matchedSkillTools) {
    options.permitted_tools = resolveEffectiveSkillTools(
      matchedSkillTools.map((tools) => tools?.map(canonicalizeToolName)),
      options.permitted_tools,
    );
  }
}

/** Authorizes this step's reported writes against the step policy. */
export function authorizedPathsOf(
  options: IAgentExecutionOptions,
  validated: IChangesetResult,
  planWrittenFiles: ReadonlySet<string>,
): string[] {
  const declaresAllowedPaths = (options.allowed_paths?.length ?? 0) > 0;
  return declaresAllowedPaths
    ? [...(options.allowed_paths ?? []), ...planWrittenFiles]
    : [...planWrittenFiles, ...(validated.files_changed ?? [])];
}

/** Resolve the executeStep strategy. MCP and CLI use explicit capabilities.
 * ReAct is the default for provider-backed execution. */
export function resolveStrategyName(
  blueprint: IAgentFileBlueprint,
  options: IAgentExecutionOptions,
): ExecutionStrategyName {
  if (options.strategy) {
    return options.strategy;
  }
  if (blueprint.capabilities.includes(ExecutionStrategyName.MCP)) {
    return ExecutionStrategyName.MCP;
  }
  if (blueprint.capabilities.includes(ExecutionStrategyName.CLI_DELEGATE)) {
    return ExecutionStrategyName.CLI_DELEGATE;
  }
  return ExecutionStrategyName.REACT;
}

/** Sections the step expects to fill. An unused section is returned to the others, so pinned skills must be declared. */
export function stepAllocationHints(
  options: IAgentExecutionOptions,
  pinnedSkills: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
  strategyName: ExecutionStrategyName,
  provider: Opt<IModelProvider, Reason.OptionalDependency>,
): Opt<IAllocationHints, Reason.OptionalInput> {
  const hints: IAllocationHints = {};
  // A ReAct loop carries prior actions and tool results into every later turn, in text and native mode.
  const loops = strategyName === ExecutionStrategyName.REACT ||
    (options.native_tools_enabled && provider && providerSupportsNativeConversation(provider.id));
  if (loops) {
    hints.loopHistoryUsedTokens = options.max_tool_calls * PLANNING_TOOL_CALL_OVERHEAD_TOKENS;
  }
  if (pinnedSkills && pinnedSkills.text.length > 0) {
    hints.skillsUsedTokens = Math.ceil(pinnedSkills.text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

/** The real usage block of one strategy result, when one was reported. */
export function usageReportOf(validated: IChangesetResult): Opt<IComposerUsage, Reason.OptionalInput> {
  if (!validated.usage) return undefined;
  const usage = validated.usage;
  return {
    tokens: usage.prompt_tokens + usage.completion_tokens,
    cost_usd_estimate: usage.cost_usd,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    cost_source: usage.cost_source,
  };
}

/** Resolves the target portal and checks the role, inside the step's failure and cleanup boundary. */
export function resolveStepPortal(
  config: Config,
  permissions: PortalPermissionsService,
  options: IAgentExecutionOptions,
): IPortalConfig {
  const portal = config.portals?.find((p) => p.alias === options.portal);
  if (!portal) throw new Error(`Portal not found: ${options.portal}`);
  if (!permissions.checkAgentAllowed(options.portal, options.agent_role ?? "").allowed) {
    throw new Error(`Agent role not allowed to access portal: ${options.agent_role} -> ${options.portal}`);
  }
  return portal;
}

/**
 * Build subprocess permissions based on security mode
 */
export function buildSubprocessPermissions(
  mode: SecurityMode,
  portalPath: string,
): string[] {
  const flags: string[] = [];

  if (mode === SecurityMode.SANDBOXED) {
    // No file system access
    flags.push("--allow-read=NONE");
    flags.push("--allow-write=NONE");
  } else if (mode === SecurityMode.HYBRID) {
    // Read-only access to portal
    flags.push(`--allow-read=${portalPath}`);
    flags.push("--allow-write=NONE");
  }

  // Always allow network (for MCP connection)
  flags.push("--allow-net");

  // Always allow environment variables
  flags.push("--allow-env");

  return flags;
}
