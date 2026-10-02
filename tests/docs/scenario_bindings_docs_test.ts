/**
 * @module ScenarioBindingsDocsTest
 * @path tests/docs/scenario_bindings_docs_test.ts
 * @description Verifies the scenario authoring docs describe scenario bindings, presets, pins, judge
 * selectors, the overlay layer order and trust boundary, and explicit Ollama selection.
 * @architectural-layer Tests
 * @dependencies [@exaix/schemas]
 * @related-files [tests/scenario_framework/AUTHORING.md, tests/scenario_framework/SCENARIO_DSL.md, tests/docs/helpers.ts]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { BindingFieldSchema, PinReasonSchema } from "@exaix/schemas/model_binding.ts";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../scenario_framework/schema/scenario_schema.ts";
import { SCHEMA_VERSION } from "../scenario_framework/schema/version.ts";
import { type IScenarioBindingPlan, orderedRequestOverlays } from "../scenario_framework/runner/binding_layers.ts";
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

Deno.test("[docs] evidence and judge examples name their scenario, trial and request scope", async () => {
  const evaluation = flatten(await Deno.readTextFile(EVALUATION));
  assertEvery(evaluation, [
    "requestStepId",
    'outcome: "refused"',
    "qualified: false",
    "trial",
  ]);
  const docs = flatten(await authoringDocs());
  assertStringIncludes(docs, "the same ordered overlay list as the request it grades");
  assertStringIncludes(docs, "per-invocation directory");
});

Deno.test("[docs] documented overlay order matches the shared request-and-judge ordering helper", async () => {
  const docs = flatten(await authoringDocs());
  const plan: IScenarioBindingPlan = {
    overlays: [
      { role: "scenario", path: "10-scenario.json", sha256: "a".repeat(64) },
      { role: "cell", path: "20-cell.json", sha256: "b".repeat(64) },
      { role: "step", stepId: "submit", path: "25-step-submit.json", sha256: "c".repeat(64) },
      { role: "operator", path: "30-operator-0.json", sha256: "d".repeat(64) },
      { role: "operator", path: "40-operator-bind.json", sha256: "e".repeat(64) },
    ],
    pins: [],
  };
  const ordered = orderedRequestOverlays(plan, "submit");
  assertEquals(ordered.map((overlay) => overlay.role), ["scenario", "cell", "step", "operator", "operator"]);

  // The docs name each layer file in the same order the helper returns it.
  const tokens = [
    "10-scenario.json",
    "20-cell.json",
    "25-step-<step-id>.json",
    "30-operator-",
    "40-operator-bind.json",
  ];
  const positions = tokens.map((token) => docs.indexOf(token));
  assert(positions.every((position) => position >= 0), "the docs must name every overlay layer file");
  assertEquals([...positions].sort((a, b) => a - b), positions);
});

/** The keys that mark a YAML example as a scenario fragment rather than a step list or a single step. */
const SCENARIO_FRAGMENT_KEYS = ["bindings", "catalog", "pin", "matrix"];

Deno.test("[docs] every scenario YAML example in SCENARIO_DSL.md parses through the schema", async () => {
  const dsl = await Deno.readTextFile(SCENARIO_DSL);
  const blocks = [...dsl.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
  const base = {
    schema_version: SCHEMA_VERSION,
    id: "docs-example",
    title: "Docs example",
    pack: "agent_flows",
    tags: ["smoke"],
    request_fixture: "fixtures/requests/agent_flows/openai_compatible_native.md",
    mode_support: ["auto"],
    portals: [],
    steps: [{ id: "submit", type: "exactl", command: "request" }],
  };
  let checked = 0;
  for (const block of blocks) {
    const parsed = parseYaml(block);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    if (!Object.keys(parsed).some((key) => SCENARIO_FRAGMENT_KEYS.includes(key))) continue;
    const fragment = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => SCENARIO_FRAGMENT_KEYS.includes(key)),
    );
    const result = ScenarioSchema.safeParse({ ...base, ...fragment });
    assert(
      result.success,
      `example does not validate: ${block.slice(0, 120)}\n${JSON.stringify(result.error?.issues)}`,
    );
    checked++;
  }
  assert(checked >= 3, `expected at least 3 scenario examples, found ${checked}`);
});
