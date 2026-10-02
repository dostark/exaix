/**
 * @module ScenarioBindingsDocsTest
 * @path tests/docs/scenario_bindings_docs_test.ts
 * @description Verifies the scenario authoring docs describe scenario bindings, presets, pins, judge
 * selectors, the overlay layer order and trust boundary, and explicit Ollama selection.
 * @architectural-layer Tests
 * @dependencies [@exaix/schemas]
 * @related-files [tests/scenario_framework/AUTHORING.md, tests/scenario_framework/SCENARIO_DSL.md, tests/docs/helpers.ts]
 */
import { assert, assertStringIncludes } from "@std/assert";
import { BindingFieldSchema, PinReasonSchema } from "@exaix/schemas/model_binding.ts";
import { readUserGuide } from "./helpers.ts";

const AUTHORING = "tests/scenario_framework/AUTHORING.md";
const SCENARIO_DSL = "tests/scenario_framework/SCENARIO_DSL.md";
const EVALUATION = "docs/Exaix_Evaluation.md";

async function authoringDocs(): Promise<string> {
  return (await Deno.readTextFile(AUTHORING)) + "\n" + (await Deno.readTextFile(SCENARIO_DSL));
}

function flatten(text: string): string {
  return text.replace(/\s+/g, " ");
}

function assertEvery(text: string, tokens: readonly string[]): void {
  for (const token of tokens) assertStringIncludes(text, token);
}

Deno.test("[docs] AUTHORING.md and SCENARIO_DSL.md document every scenario binding field, pin reason, judge selector, the overlay ordering rule, the overlay trust boundary and the explicit ollama-chat selection", async () => {
  const docs = flatten(await authoringDocs());
  assertEvery(docs, [
    "bindings:",
    "catalog:",
    "pin:",
    "from_catalog",
    "selector",
    "fields",
    "reason",
    "note",
    ...BindingFieldSchema.options,
    ...PinReasonSchema.options,
    "`judge`",
    "`judge:<step-id>`",
    "`${tool}-${provider}`",
    "`axes`",
    "`--overlay`",
    "`--bind`",
    "`pinned`",
    "`pin_kept`",
    "`ambiguous_selector`",
    '`kind: "gate"`',
    "`needs_restart`",
    "`allow_net`",
    "symlink",
    "`--no-sandbox`",
    'service = "ollama-chat"',
  ]);
  assertStringIncludes(docs, "removing it from operator entries");
  assertStringIncludes(docs, "the later layer");
  assertStringIncludes(docs, "two distinct equally-specific selectors");
  assertStringIncludes(docs, "outside the sandbox");
  assertStringIncludes(docs, "`default`, `role:` and `flow:` do not apply to a scenario judge");
});

Deno.test("[docs] every Affected Interfaces entry is named in the authoring docs, User Guide or Architecture", async () => {
  const text = (await authoringDocs()) + (await readUserGuide()) + (await Deno.readTextFile("ARCHITECTURE.md"));
  assertEvery(text, [
    "ScenarioSchema",
    "MatrixSchema",
    "MatrixCellSchema",
    "ICatalogPreset",
    "BindingStepKind",
    "loadBindingLayers",
    "loadOverlays",
    "BINDING_OVERLAY_MAX_BYTES",
    "CompatibleChatFieldsSchema",
    "supports_tool_choice",
    "IProviderCallCapabilities",
    "supportsToolChoice",
    "createOpenAIChatCompletionsRequestInit",
    "OpenAICompatibleProviderFactory.readKey",
    "OPENAI_COMPATIBLE_UNPRICED_PROFILES",
    "planScenarioBindings",
    "compatFixturePort",
    "IProviderLiveEvidenceInput",
  ]);
});

Deno.test("[docs] the Evaluation guide documents presets, judge bindings, pins and the evidence fields", async () => {
  const evaluation = flatten(await Deno.readTextFile(EVALUATION));
  assertEvery(evaluation, [
    "from_catalog",
    "`overlays`",
    "`lock.entries`",
    "`judges`",
    "`pins`",
    "`judgeSharesSut`",
    "`allow_net`",
    "`needs_restart`",
    'service = "ollama-chat"',
  ]);
});

Deno.test("[docs] no doc presents a meta/qwen preference route for Ollama", async () => {
  const files = [AUTHORING, SCENARIO_DSL, EVALUATION, "docs/Exaix_User_Guide.md", "ARCHITECTURE.md"];
  for (const file of files) {
    const text = await Deno.readTextFile(file);
    assert(!/^\s*(meta|qwen)\s*=\s*\[/m.test(text), `${file} declares a meta/qwen preference list`);
    assert(!/preferences[^\n]*\b(meta|qwen)\b\s*[:=]/.test(text), `${file} routes Ollama by a meta/qwen preference`);
  }
});
