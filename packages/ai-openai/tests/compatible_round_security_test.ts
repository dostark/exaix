/**
 * @module CompatibleRoundSecurityTest
 * @path packages/ai-openai/tests/compatible_round_security_test.ts
 * @description Rejection-by-validation for untrusted compatible responses. A round with one bad call is
 *   refused before any call executes, and a request whose replayed history repeats a call id is refused
 *   before it reaches the wire.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai-openai, @exaix/ai]
 * @related-files [
 *   "packages/ai-openai/src/compatible_chat.ts",
 *   "packages/ai-openai/tests/helpers/compatible_round_fixture.ts"
 * ]
 */
import { assertThrows } from "@std/assert";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import { FIXED_NATIVE_ROUND_LIMITS } from "@exaix/ai/native_round_limits.ts";
import type { OpenAIResponse } from "@exaix/ai/provider_common_utils.ts";
import { type IModelOptions, TOOL_CHOICE_TYPE_NONE } from "@exaix/ai/types.ts";
import { createCompatibleChatRequestInit, validateCompatibleResponse } from "../src/compatible_chat.ts";
import {
  ARGUMENT_LIMIT,
  call,
  completion,
  options,
  PRIOR_ROUND,
  PROVIDER_ID,
} from "./helpers/compatible_round_fixture.ts";

const REFUSALS: Array<{ name: string; response: OpenAIResponse; options?: IModelOptions }> = [
  { name: "a duplicate call id", response: completion([call("call-a"), call("call-a")], "tool_calls") },
  {
    name: "an unadvertised second call",
    response: completion([call("call-a"), call("call-b", "write_file")], "tool_calls"),
  },
  { name: "malformed second arguments", response: completion([call("call-a"), call("call-b", "{")], "tool_calls") },
  { name: "array second arguments", response: completion([call("call-a"), call("call-b", "[]")], "tool_calls") },
  {
    name: "oversized second arguments",
    response: completion(
      [call("call-a"), call("call-b", JSON.stringify({ path: "x".repeat(ARGUMENT_LIMIT) }))],
      "tool_calls",
    ),
  },
  { name: "calls with finish_reason stop", response: completion([call("call-a")], "stop") },
  { name: "finish_reason tool_calls without calls", response: completion([], "tool_calls") },
  {
    name: "a call id consumed by an earlier round",
    response: completion([call("call-a")], "tool_calls"),
    options: options({ nativeConversation: { initialPrompt: "prompt", turns: [], rounds: [PRIOR_ROUND] } }),
  },
  {
    name: "calls under tool choice none",
    response: completion([call("call-a")], "tool_calls"),
    options: options({ toolChoice: { type: TOOL_CHOICE_TYPE_NONE } }),
  },
  {
    name: "more calls than the response ceiling",
    response: completion(
      Array.from({ length: FIXED_NATIVE_ROUND_LIMITS.maxResponseCalls + 1 }, (_, index) => call(`call-${index}`)),
      "tool_calls",
    ),
  },
];

for (const refusal of REFUSALS) {
  Deno.test(`[security] compatible round refuses ${refusal.name} before any tool effect`, () => {
    assertThrows(
      () => validateCompatibleResponse(refusal.response, PROVIDER_ID, ARGUMENT_LIMIT, refusal.options ?? options()),
      ProviderProtocolError,
    );
  });
}

Deno.test("[security] compatible request refuses a call id that repeats across grouped history", () => {
  assertThrows(
    () =>
      createCompatibleChatRequestInit(
        "key",
        "compat-fixture-v1",
        "prompt",
        options({ nativeConversation: { initialPrompt: "prompt", turns: [], rounds: [PRIOR_ROUND, PRIOR_ROUND] } }),
      ),
    ProviderProtocolError,
  );
});
