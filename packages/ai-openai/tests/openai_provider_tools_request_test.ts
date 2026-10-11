/**
 * @module OpenAiProviderToolsRequestTest
 * @path packages/ai-openai/tests/openai_provider_tools_request_test.ts
 * @description The tool-call capabilities that OpenAI-compatible profiles declare: whether a profile honors an explicit
 *   tool_choice, and whether it refuses a forced one while thinking. Native OpenAI calls use the Responses API, and
 *   their request and replay tests live in openai_responses_provider_test.ts.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-openai/src/openai_provider.ts",
 *   "packages/ai-openai/tests/openai_responses_provider_test.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { OpenAIProvider } from "../src/openai_provider.ts";

const SELF_HOSTED_ENDPOINT = "https://gpu.internal/v1/chat/completions";

function selfHostedProvider(supportsToolChoice?: boolean): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: "",
    model: "llama3.1:8b",
    compatible: {
      profile: "self-hosted",
      endpoint: SELF_HOSTED_ENDPOINT,
      model: "llama3.1:8b",
      allow_insecure_loopback: false,
      max_response_bytes: 4096,
      max_tool_argument_bytes: 512,
      max_history_bytes: 4096,
      ...(supportsToolChoice === undefined ? {} : { supports_tool_choice: supportsToolChoice }),
    },
  });
}

Deno.test("[phase203.provider] supportsToolChoice follows the self-hosted declaration and stays absent elsewhere", () => {
  assertEquals(selfHostedProvider().callCapabilities?.supportsToolChoice, false);
  assertEquals("supportsToolChoice" in selfHostedProvider().callCapabilities!, true);
  assertEquals("supportsToolChoice" in selfHostedProvider(true).callCapabilities!, false);
  for (const profile of ["openai", "deepseek", "local-test"] as const) {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "compat-fixture-v1",
      compatible: {
        profile,
        endpoint: "http://127.0.0.1:4312/v1/chat/completions",
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    assertEquals("supportsToolChoice" in provider.callCapabilities!, false, profile);
  }
});

// DeepSeek answered HTTP 400 "Thinking mode does not support this tool_choice" for a named
// tool and for "required" on 2026-10-05. Thinking with "auto" returned 200.
Deno.test("[provider] only the DeepSeek profile refuses a forced tool_choice while thinking", () => {
  for (const profile of ["openai", "deepseek", "local-test"] as const) {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "compat-fixture-v1",
      compatible: {
        profile,
        endpoint: "http://127.0.0.1:4312/v1/chat/completions",
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    assertEquals(
      provider.callCapabilities?.supportsForcedToolChoiceWithThinking,
      profile === "deepseek" ? false : undefined,
      profile,
    );
  }
});
