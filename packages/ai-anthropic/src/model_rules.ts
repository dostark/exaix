/**
 * @module AnthropicModelRules
 * @path packages/ai-anthropic/src/model_rules.ts
 * @description Per-model Messages API rules for effort, thinking and forced tool_choice. The rules follow the Anthropic
 *   docs and were checked against the live API. A model with no entry keeps the previous request mapping.
 * @architectural-layer AI
 * @related-files ["packages/ai-anthropic/src/anthropic_provider.ts", "packages/ai/src/provider_call_options.ts"]
 */

import type { IProviderCallCapabilities } from "@exaix/ai";
import type { Opt, Reason } from "@exaix/core/types";
import {
  ANTHROPIC_EFFORT_MAX,
  ANTHROPIC_EFFORT_TIERS,
  ANTHROPIC_EFFORT_XHIGH,
  ANTHROPIC_THINKING_ADAPTIVE,
  ANTHROPIC_THINKING_BETWEEN_TOOLS,
  ANTHROPIC_THINKING_DISABLED,
  ANTHROPIC_THINKING_ENABLED,
  PROVIDER_ANTHROPIC,
} from "./constants.ts";

/** How one model takes the effort and thinking settings, and whether it accepts a forced tool_choice. */
export interface IAnthropicModelRules {
  /** The model accepts output_config.effort. Haiku 4.5 rejects it with a 400. */
  readonly effort: boolean;
  /** The thinking type an explicit thinking:true sends. Manual models take a budget_tokens value. */
  readonly thinkingOn: typeof ANTHROPIC_THINKING_ADAPTIVE | typeof ANTHROPIC_THINKING_ENABLED;
  /** The thinking type an explicit thinking:false sends, or null when the model cannot turn thinking off. */
  readonly thinkingOff: typeof ANTHROPIC_THINKING_DISABLED | typeof ANTHROPIC_THINKING_BETWEEN_TOOLS | null;
  /** The model accepts a forced tool_choice (any, tool) in every thinking mode. */
  readonly forcedToolChoice: boolean;
}

/** A thinking field as the Messages API takes it. */
interface IAnthropicThinkingField {
  type: string;
  budget_tokens?: number;
}

/** The request settings the rules shape: the caller's thinking flag, token limit, budget and effort. */
interface IRequestTuningInput {
  /** The caller's thinking flag, after the config default. */
  thinking: boolean | undefined;
  maxTokens: number;
  thinkingBudget?: number;
  effort?: string;
}

/** The fields a request takes from the rules. */
interface IRequestTuning {
  maxTokens: number;
  thinking?: IAnthropicThinkingField;
  outputConfig?: { effort: string };
  /** The caller asked for thinking off, and the model cannot honour it at this effort. Adaptive was sent instead. */
  thinkingOffRefused: boolean;
}

/** The smallest budget_tokens the API accepts for manual extended thinking. */
const MANUAL_THINKING_MIN_BUDGET = 1024;
/** Room kept above a manual thinking budget, because max_tokens must exceed budget_tokens. */
const MANUAL_THINKING_ANSWER_HEADROOM = 1024;

const RULES: Readonly<Record<string, IAnthropicModelRules>> = {
  "claude-haiku-5-5": {
    effort: true,
    thinkingOn: ANTHROPIC_THINKING_ADAPTIVE,
    thinkingOff: ANTHROPIC_THINKING_DISABLED,
    forcedToolChoice: true,
  },
  "claude-sonnet-5-5": {
    effort: true,
    thinkingOn: ANTHROPIC_THINKING_ADAPTIVE,
    thinkingOff: ANTHROPIC_THINKING_BETWEEN_TOOLS,
    forcedToolChoice: false,
  },
  "claude-opus-5-5": {
    effort: true,
    thinkingOn: ANTHROPIC_THINKING_ADAPTIVE,
    thinkingOff: null,
    forcedToolChoice: false,
  },
  "claude-haiku-4-5-20251001": {
    effort: false,
    thinkingOn: ANTHROPIC_THINKING_ENABLED,
    thinkingOff: ANTHROPIC_THINKING_DISABLED,
    forcedToolChoice: true,
  },
};

/** The rules for a model, or undefined when the model has no entry. */
export function anthropicModelRules(model: string): IAnthropicModelRules | undefined {
  const rules: IAnthropicModelRules | undefined = RULES[model];
  return rules;
}

/** The thinking field a request carries. `thinking` is the caller's flag after the config default. */
function thinkingFieldFor(
  thinking: Opt<boolean, Reason.OptionalInput>,
  rules: Opt<IAnthropicModelRules, Reason.OptionalContext>,
  budget: number,
): IAnthropicThinkingField | undefined {
  if (rules === undefined) return thinking === false ? { type: ANTHROPIC_THINKING_DISABLED } : undefined;
  if (thinking === true) {
    return rules.thinkingOn === ANTHROPIC_THINKING_ADAPTIVE
      ? { type: ANTHROPIC_THINKING_ADAPTIVE }
      : { type: ANTHROPIC_THINKING_ENABLED, budget_tokens: budget };
  }
  if (thinking === false && rules.thinkingOff !== null) return { type: rules.thinkingOff };
  return undefined;
}

/** The thinking, token and effort fields of one request, shaped by the model's rules. */
export function requestTuning(
  input: IRequestTuningInput,
  rules?: Opt<IAnthropicModelRules, Reason.OptionalContext>,
): IRequestTuning {
  const budget = Math.max(MANUAL_THINKING_MIN_BUDGET, input.thinkingBudget ?? MANUAL_THINKING_MIN_BUDGET);
  const manual = input.thinking === true && rules?.thinkingOn === ANTHROPIC_THINKING_ENABLED;
  const atHighestEffort = rules?.effort === true &&
    (input.effort === ANTHROPIC_EFFORT_XHIGH || input.effort === ANTHROPIC_EFFORT_MAX);
  // Disabled and between_tools are refused at xhigh and max, and Opus 5.5 cannot turn thinking off at all.
  const thinkingOffRefused = input.thinking === false && rules !== undefined &&
    (rules.thinkingOff === null || atHighestEffort);
  return {
    // max_tokens must exceed a manual thinking budget, so the answer keeps headroom above it.
    maxTokens: manual ? Math.max(input.maxTokens, budget + MANUAL_THINKING_ANSWER_HEADROOM) : input.maxTokens,
    thinking: thinkingOffRefused
      ? { type: ANTHROPIC_THINKING_ADAPTIVE }
      : thinkingFieldFor(input.thinking, rules, budget),
    ...(rules?.effort === true && input.effort !== undefined ? { outputConfig: { effort: input.effort } } : {}),
    thinkingOffRefused,
  };
}

/** The capabilities the call projection reads. Effort tiers are declared only where effort is sent. */
export function anthropicCallCapabilities(model: string): IProviderCallCapabilities {
  const rules = anthropicModelRules(model);
  return Object.freeze({
    profile: PROVIDER_ANTHROPIC,
    supportsThinking: true,
    supportedEffortTiers: rules?.effort === true ? ANTHROPIC_EFFORT_TIERS : [],
    ...(rules !== undefined && !rules.forcedToolChoice ? { supportsForcedToolChoice: false } : {}),
  });
}
