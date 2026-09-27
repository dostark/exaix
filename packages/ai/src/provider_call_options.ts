/**
 * @module ProviderCallOptions
 * @path packages/ai/src/provider_call_options.ts
 * @description Projects call controls onto the capabilities a provider can serialize.
 * @architectural-layer AI
 * @dependencies [@exaix/ai/types.ts]
 * @related-files [packages/ai/src/provider_registry.ts, packages/ai-openai/src/openai_provider.ts]
 */
import { EFFORT_AUTO, type EffortTier } from "@exaix/schemas";
import type { IEffortDeclarations, IEffortResolution } from "./effort_resolver.ts";
import { ProviderCallPolicyError } from "./errors.ts";
import type { IModelOptions } from "./types.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IProviderCallCapabilities {
  readonly profile: string;
  readonly supportedEffortTiers: readonly EffortTier[];
  readonly supportsThinking: boolean;
  readonly effortRequiresThinking?: boolean;
}

export interface IProjectedCallOptions {
  effort?: EffortTier;
  thinking?: boolean;
  profile?: string;
  reason?: "profile_unsupported_effort";
}

/** Keeps the resolution intact for allocation and projects only its wire controls. */
export function projectResolvedCallOptions(
  resolution: IEffortResolution,
  declarations: IEffortDeclarations,
  capabilities?: Opt<IProviderCallCapabilities, Reason.OptionalContext>,
): IProjectedCallOptions {
  if (!capabilities) return { effort: resolution.effort, thinking: resolution.thinking };
  const effortDeclaration = resolution.effortDeclarationSource === "request"
    ? declarations.request?.effort
    : resolution.effortDeclarationSource === "flow_step"
    ? declarations.flowStep?.effort
    : undefined;
  const supportedEffort = resolution.effort === undefined ||
    (capabilities.supportedEffortTiers.includes(resolution.effort) &&
      (!capabilities.effortRequiresThinking || resolution.thinking === true));
  if (
    (!supportedEffort && effortDeclaration !== undefined && effortDeclaration !== EFFORT_AUTO) ||
    (resolution.thinking === true && !capabilities.supportsThinking)
  ) {
    throw new ProviderCallPolicyError("unsupported_call_option", capabilities.profile);
  }
  return {
    effort: supportedEffort ? resolution.effort : undefined,
    thinking: capabilities.supportsThinking ? resolution.thinking : undefined,
    profile: capabilities.profile,
    ...(!supportedEffort ? { reason: "profile_unsupported_effort" } : {}),
  };
}

/** Direct callers supply explicit controls. Their values do not establish provenance. */
export function assertSupportedCallOptions(
  options: Opt<IModelOptions, Reason.OptionalInput>,
  capabilities: IProviderCallCapabilities,
): void {
  if (
    (options?.thinking === true && !capabilities.supportsThinking) ||
    (options?.effort !== undefined && (!capabilities.supportedEffortTiers.includes(options.effort) ||
      (capabilities.effortRequiresThinking && options.thinking !== true)))
  ) {
    throw new ProviderCallPolicyError("unsupported_call_option", capabilities.profile);
  }
}
