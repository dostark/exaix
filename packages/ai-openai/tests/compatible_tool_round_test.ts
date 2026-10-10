/**
 * @module CompatibleToolRoundTest
 * @path packages/ai-openai/tests/compatible_tool_round_test.ts
 * @description Proves each compatible profile accepts a bounded multi-call round, returns the calls in
 *   order, and keeps the assistant content and reasoning available for replay.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai-openai, @exaix/ai]
 * @related-files [
 *   "packages/ai-openai/src/compatible_chat.ts",
 *   "packages/ai-openai/tests/compatible_round_security_test.ts"
 * ]
 */
import { assertEquals } from "@std/assert";
import { extractOpenAIAssistantReplay, extractOpenAICompatibleToolCalls } from "@exaix/ai/provider_common_utils.ts";
import { validateCompatibleResponse } from "../src/compatible_chat.ts";
import { ARGUMENT_LIMIT, call, completion, options, PROVIDER_ID } from "./helpers/compatible_round_fixture.ts";

const PROFILES = ["openai", "deepseek", "local-test", "self-hosted"] as const;

for (const profile of PROFILES) {
  Deno.test(`compatible ${profile} accepts a two-call round and keeps the calls in order`, () => {
    const validated = validateCompatibleResponse(
      completion([call("call-a"), call("call-b")], "tool_calls"),
      PROVIDER_ID,
      ARGUMENT_LIMIT,
      options(),
      profile,
    );
    const calls = extractOpenAICompatibleToolCalls(validated, ARGUMENT_LIMIT, PROVIDER_ID);
    assertEquals(calls?.map((entry) => entry.id), ["call-a", "call-b"]);
  });
}

Deno.test("compatible round keeps the original content and reasoning for replay", () => {
  const validated = validateCompatibleResponse(
    completion([call("call-a"), call("call-b")], "tool_calls", {
      content: "I will read both files.",
      reasoning_content: "Read both first.",
      reasoning_details: [{ type: "reasoning.text", text: "Read both first." }],
    }),
    PROVIDER_ID,
    ARGUMENT_LIMIT,
    options(),
  );
  assertEquals(extractOpenAIAssistantReplay(validated, PROVIDER_ID), {
    provider: PROVIDER_ID,
    assistantContent: "I will read both files.",
    reasoningContent: "Read both first.",
    reasoningDetails: [{ type: "reasoning.text", text: "Read both first." }],
    toolCalls: [call("call-a"), call("call-b")],
  });
});
