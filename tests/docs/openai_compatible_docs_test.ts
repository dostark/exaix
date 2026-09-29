/**
 * @module OpenAICompatibleDocsTest
 * @path tests/docs/openai_compatible_docs_test.ts
 * @description Verifies the User Guide and Architecture describe the shipped openai-chat provider:
 * exact keys, presets and secrets, a parseable TOML example, and reason codes taken from source.
 * @architectural-layer Tests
 * @dependencies [@exaix/schemas, @std/toml]
 * @related-files [packages/ai/src/errors.ts, tests/docs/helpers.ts]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS } from "@exaix/core";
import { readUserGuide } from "./helpers.ts";

const COMPATIBLE_KEYS = [
  "profile",
  "endpoint",
  "allow_insecure_loopback",
  "max_response_bytes",
  "max_tool_argument_bytes",
  "max_history_bytes",
];
const PRESETS = ["configs/openai-chat.toml", "configs/deepseek-chat.toml"];
const SECRET_VARIABLES = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY"];

async function readArchitecture(): Promise<string> {
  return await Deno.readTextFile("ARCHITECTURE.md");
}

function section(text: string, heading: string): string {
  const level = heading.match(/^#+/)![0].length;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert(start >= 0, `Missing heading: ${heading}`);
  let inFence = false;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) inFence = !inFence;
    const hashes = inFence ? undefined : line.match(/^(#{1,6}) /)?.[1];
    if (hashes && hashes.length <= level) break;
    body.push(line);
  }
  return body.join("\n");
}

Deno.test("User Guide documents the openai-chat keys, presets, secrets and pinned models", async () => {
  const guide = await readUserGuide();
  const compatible = section(guide, "### 11.6 Supported Providers") +
    section(guide, "### 5.3a Execution Configuration");
  for (const token of [...COMPATIBLE_KEYS, ...PRESETS, ...SECRET_VARIABLES, "openai-chat", "[ai.compatible]"]) {
    assertStringIncludes(compatible, token);
  }
  for (const profile of ["openai", "deepseek"] as const) {
    assertStringIncludes(compatible, OPENAI_COMPATIBLE_PROFILE_DEFAULTS[profile].model);
  }
  assertStringIncludes(compatible, "api.deepseek.com");
});

Deno.test("User Guide openai-chat TOML example parses through ConfigSchema", async () => {
  const guide = await readUserGuide();
  const blocks = [...guide.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => match[1]);
  const example = blocks.find((block) => block.includes('provider = "openai-chat"'));
  assert(example, "User Guide has no openai-chat TOML example");
  const config = ConfigSchema.parse(parseToml(example));
  assertEquals(config.ai?.provider, "openai-chat");
  assertEquals(config.ai?.compatible?.profile, "openai");
  assertEquals(config.execution.native_tools_enabled, true);
});

Deno.test("User Guide inheritance and finite-cost TOML example parses through ConfigSchema", async () => {
  const guide = await readUserGuide();
  const blocks = [...guide.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => match[1]);
  const example = blocks.find((block) => block.includes("[models.strict.compatible]"));
  assert(example, "User Guide has no inheritance TOML example");
  const config = ConfigSchema.parse(parseToml(example));
  assertEquals(config.ai?.compatible?.max_response_bytes, 4194304);
  assertEquals(config.models?.strict?.compatible?.allow_insecure_loopback, false);
  assertEquals(config.rate_limiting.max_cost_per_day, 5);
});

Deno.test("User Guide lists every provider factory reason code from source", async () => {
  const guide = await readUserGuide();
  const source = await Deno.readTextFile("packages/ai/src/errors.ts");
  const union = source.match(/export type ProviderFactoryReasonCode =([\s\S]*?);/)?.[1] ?? "";
  const codes = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert(codes.length > 0, "No reason codes parsed from source");
  for (const code of [...codes, "unsupported_call_option", "pricing_unavailable", "protocol_invalid"]) {
    assertStringIncludes(guide, code);
  }
});

Deno.test("Architecture native tool-calling section describes the compatible call chain and boundaries", async () => {
  const architecture = await readArchitecture();
  const native = section(architecture, "#### 8. Native Tool-Calling");
  for (
    const token of [
      "OpenAICompatibleProviderFactory",
      "AgentRunner",
      "PlanExecutor",
      "ReActLoopStrategy",
      "LlmClient.reasonNextAction()",
      "supportsNativeConversation",
      "structuredOutputMode",
      "chatFormat",
      "ProviderFactoryError.reasonCode",
      "llmEventLogger",
      "__COMPAT_FIXTURE_PORT__",
      "Phase 202",
    ]
  ) {
    assertStringIncludes(native, token);
  }
});

Deno.test("Compatible documentation describes strict null normalization, false thinking and dynamic preflight", async () => {
  const guide = await readUserGuide();
  const architecture = await readArchitecture();
  for (const raw of [guide, architecture]) {
    const text = raw.replace(/\s+/g, " ");
    assertStringIncludes(text, "nested optional nulls");
    assertStringIncludes(text, "thinking: false");
    assertStringIncludes(text, "output token allowance");
    assertStringIncludes(text, "ContextBudgetExceeded");
  }
});

Deno.test("Phase 155 binding profile table and live scenario paths match shipped defaults", async () => {
  const plan = await Deno.readTextFile("exaix-dev-docs/planning/phase-155-openai-compatible-react.md");
  const binding = section(plan, "### Endpoint and Secret Boundary");
  for (const profile of ["openai", "deepseek"] as const) {
    assertStringIncludes(binding, OPENAI_COMPATIBLE_PROFILE_DEFAULTS[profile].model);
  }
  const step8 = section(plan, "### Step 8 — Authorized live profile qualification");
  for (const profile of ["openai", "deepseek"]) {
    const path = `tests/scenario_framework/scenarios/provider_live/${profile}-compatible-native-live.yaml`;
    assertStringIncludes(step8, path);
    assert((await Deno.stat(path)).isFile);
  }
});
