/**
 * @module CompatibleRoundFixture
 * @path packages/ai-openai/tests/helpers/compatible_round_fixture.ts
 * @description Wire fixtures shared by the compatible tool-round tests: one tool call, the call options a
 *   planning round sends, one completed round of snapshot history, and a response as the server sends it.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-openai/tests/compatible_tool_round_test.ts",
 *   "packages/ai-openai/tests/compatible_round_security_test.ts"
 * ]
 */

import type { JSONValue } from "@exaix/core";
import type { OpenAIResponse } from "@exaix/ai/provider_common_utils.ts";
import type { IModelOptions, IProviderToolRound, JSONObject } from "@exaix/ai/types.ts";

export const PROVIDER_ID = "openai-chat";
export const ARGUMENT_LIMIT = 512;

export function call(id: string, name = "read_file", args = '{"path":"a.ts"}'): JSONObject {
  return { id, type: "function", function: { name, arguments: args } };
}

export const PRIOR_ROUND: IProviderToolRound = {
  calls: [{
    toolUseId: "call-a",
    index: 0,
    toolName: "read_file",
    toolInput: { path: "a.ts" },
    toolResultContent: "BODY",
    toolResultIsError: false,
  }],
  assistant: { provider: PROVIDER_ID, assistantContent: null, toolCalls: [call("call-a")] },
};

export function options(extra: IModelOptions = {}): IModelOptions {
  return {
    tools: [{ name: "read_file", inputSchema: { type: "object" } }],
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
    ...extra,
  };
}

/** The wire response as the server sends it. OpenAIResponse does not declare finish_reason, so the fixture is parsed. */
export function completion(
  calls: JSONValue[],
  finishReason: string,
  message: Record<string, JSONValue> = {},
): OpenAIResponse {
  return JSON.parse(JSON.stringify({
    model: "returned-model",
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    choices: [{
      message: { role: "assistant", content: null, tool_calls: calls, ...message },
      finish_reason: finishReason,
    }],
  }));
}
