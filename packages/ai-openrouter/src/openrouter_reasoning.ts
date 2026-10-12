/**
 * @module OpenRouterReasoning
 * @path packages/ai-openrouter/src/openrouter_reasoning.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_model_capabilities.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/core"]
 * @description Maps the run's effort, thinking budget and thinking switch to the OpenRouter reasoning object.
 * A control is sent only in a form that the model's own capability entry accepts. An unsupported control is
 * dropped, never remapped to a nearby value.
 */

import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IOpenRouterModelEntry } from "./openrouter_model_capabilities.ts";

type ReasoningOptions = Pick<IModelOptions, "effort" | "thinking" | "thinking_budget">;

/** True when the call carries a reasoning control, so the provider needs the model's capability entry. */
export function hasReasoningOption(options: Opt<ReasoningOptions, Reason.OptionalInput>): boolean {
  return options?.effort !== undefined || options?.thinking !== undefined || options?.thinking_budget !== undefined;
}

/** The `reasoning` body field, or undefined when no control qualifies. Effort wins over a budget. */
export function reasoningFor(
  options: Opt<ReasoningOptions, Reason.OptionalInput>,
  entry: Opt<IOpenRouterModelEntry, Reason.OptionalContext>,
): Record<string, JSONValue> | undefined {
  const reasoning = entry?.reasoning;
  if (!reasoning) return undefined;
  if (options?.effort !== undefined && reasoning.supportedEfforts.includes(options.effort)) {
    return { effort: options.effort };
  }
  if (options?.thinking_budget !== undefined && reasoning.supportsMaxTokens) {
    return { max_tokens: options.thinking_budget };
  }
  if (options?.thinking === false && !reasoning.mandatory) return { enabled: false };
  return undefined;
}
