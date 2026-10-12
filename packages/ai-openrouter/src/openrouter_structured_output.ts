/**
 * @module OpenRouterStructuredOutput
 * @path packages/ai-openrouter/src/openrouter_structured_output.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai/src/structured_output.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/core"]
 * @description Structured output for the OpenRouter request. A schema plans a strict json_schema response
 * format first. A route that refuses it gets one json_object retry with the schema in the prompt. The final
 * reply is validated locally, so the caller gets schema-valid JSON or a typed error, never free text.
 */

import {
  type IStructuredOutputPlan,
  planJsonObjectOutput,
  planStructuredOutput,
  type StructuredOutputProfile,
  validateStructuredOutput,
} from "@exaix/ai";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { OpenAiChatMessage } from "@exaix/ai/provider_common_utils.ts";
import type { JSONValue } from "@exaix/core";
import { OPENROUTER_ERROR_FIELD_MAX_CHARS } from "./constants.ts";

const OPENROUTER_STRUCTURED_OUTPUT_PROFILE: StructuredOutputProfile = "openai";
const JSON_MODE_INSTRUCTION_SEPARATOR = "\n\n";

function capFailure(text: string): string {
  return text.slice(0, OPENROUTER_ERROR_FIELD_MAX_CHARS);
}

function failureText(error: Error | string): string {
  return capFailure(typeof error === "string" ? error : error.message);
}

/** Plans the strongest response format for the schema. An unsupported schema fails before any fetch. */
export function planOpenRouterOutput(schema: Record<string, JSONValue>, providerId: string): IStructuredOutputPlan {
  try {
    return planStructuredOutput(OPENROUTER_STRUCTURED_OUTPUT_PROFILE, schema);
  } catch (error) {
    throw new ProviderProtocolError(`Unsupported structured-output schema: ${failureText(error as Error)}`, providerId);
  }
}

/** The one retry plan for a route that refused json_schema. There is no weaker mode after it. */
export function planRouteFallback(schema: Record<string, JSONValue>): IStructuredOutputPlan {
  return planJsonObjectOutput(schema, "route_refused_json_schema");
}

/** Adds the json_object instruction to the message that carries the caller's prompt. */
export function applyJsonModeInstruction(
  messages: OpenAiChatMessage[],
  prompt: string,
  instruction: string,
  providerId: string,
): void {
  const promptMessage = messages.find((message) => message.role === "user" && message.content === prompt);
  if (!promptMessage) throw new ProviderProtocolError("OpenRouter request has no prompt message", providerId);
  promptMessage.content = `${prompt}${JSON_MODE_INSTRUCTION_SEPARATOR}${instruction}`;
}

/** Records the chosen mode, and replaces a final reply with its validated JSON. Tool calls are not validated. */
export function completeStructuredOutput(
  result: IGenerateResult,
  schema: Record<string, JSONValue>,
  plan: IStructuredOutputPlan,
  providerId: string,
): IGenerateResult {
  const completed: IGenerateResult = {
    ...result,
    structuredOutputMode: plan.mode,
    ...(plan.reason !== undefined ? { structuredOutputModeReason: plan.reason } : {}),
  };
  if (result.toolCalls !== undefined && result.toolCalls.length > 0) return completed;
  try {
    completed.content = JSON.stringify(
      validateStructuredOutput(result.content, schema, OPENROUTER_STRUCTURED_OUTPUT_PROFILE),
    );
  } catch (error) {
    throw new ProviderProtocolError(
      `Structured output failed schema validation: ${failureText(error as Error)}`,
      providerId,
    );
  }
  return completed;
}
