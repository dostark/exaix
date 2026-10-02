/**
 * @module JudgeBindingsTest
 * @path tests/scenario_framework/tests/unit/judge_bindings_test.ts
 * @description Phase 203 Step 3 — a scenario judge resolves through the same binding layers a
 *   flow step uses. This file covers the judge-bearing-step predicate, judge resolution against
 *   the scenario layer stack, the `judge:<id>` override, and the precedence between the mock
 *   setting and a bound judge. The flow gate path is regression-covered in
 *   packages/ai/tests/bindings/binding_resolver_test.ts.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/judge_bindings.ts, tests/scenario_framework/runner/assertions.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { BindingIncompatibleError } from "@exaix/ai";
import { fromFileUrl, join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { type IResolvedBinding, type IRunBindingsFile, RunBindingsFileSchema } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import { loadCellCatalog } from "../../runner/cell_catalog.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import {
  CriterionKind,
  CriterionPhase,
  CriterionStatus,
  type IScenarioStep,
  ScenarioStepSchema,
} from "../../schema/step_schema.ts";
import { callLlmEndpoint, evaluateLlmJudgeCriterion, type IEvaluateCriterionOptions } from "../../runner/assertions.ts";
import {
  assertJudgeBindingsResolved,
  buildJudgeStepRef,
  isJudgeBearingStep,
  judgeSharesSut,
  resolveJudgeBindings,
} from "../../runner/judge_bindings.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

/** A step whose output criteria carry a judge criterion only when asked. */
function judgeStep(id: string, ownsJudgeCriterion: boolean): IScenarioStep {
  return ScenarioStepSchema.parse({
    id,
    type: "judge",
    output_criteria: ownsJudgeCriterion
      ? [{ id: `${id}-quality`, kind: CriterionKind.LLM_JUDGE, preset: "task_fulfillment", score_threshold: 0.7 }]
      : [{ id: `${id}-exit`, kind: CriterionKind.COMMAND_EXIT_CODE, equals: 0 }],
  });
}

/** A scenario config carrying one judge service that serves two models. */
async function writeJudgeConfig(dir: string): Promise<string> {
  const configPath = join(dir, "exa.config.toml");
  await Deno.writeTextFile(
    configPath,
    [
      "[system]",
      "",
      "[paths]",
      "",
      "[ai]",
      'provider = "mock"',
      'model = "boot-model"',
      "",
      '[catalog.models."mock/judge-model"]',
      'model_provider = "mock"',
      "",
      '[catalog.models."mock/judge-model-2"]',
      'model_provider = "mock"',
      "",
      "[catalog.services.judge-svc]",
      'adapter = "mock"',
      'transport = "local"',
      'interface = "api"',
      'serves = { "mock/judge-model" = "judge-model", "mock/judge-model-2" = "judge-model-2" }',
      "",
    ].join("\n"),
  );
  return configPath;
}

/** The run's binding file, as the runner writes it for a scenario and its cells. */
function judgeRunFile(bindings: Record<string, Record<string, string>>): IRunBindingsFile {
  return RunBindingsFileSchema.parse({
    schema: 1,
    trace_id: crypto.randomUUID(),
    request_path: "fixtures/requests/shared/judge.md",
    request_sha256: "a".repeat(64),
    created_at: new Date().toISOString(),
    overlays: [{
      source_path: "10-scenario.json",
      sha256: "b".repeat(64),
      overlay: { schema: 1, bindings },
    }],
    binds: [],
  });
}

/** A binding the provider factory cannot build, used to prove whether it was consulted. */
const UNBUILDABLE_BINDING: IResolvedBinding = {
  service: "judge-svc",
  model_provider: "mock",
  model: "mock/judge-model",
  service_model_id: "judge-model",
  transport: "local",
  interface: "api",
  adapter: "not-a-provider",
  sources: {},
  fingerprint: "c".repeat(64),
};

function judgeCriterionOptions(overrides: Partial<IEvaluateCriterionOptions>): IEvaluateCriterionOptions {
  return {
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "judge-quality",
      kind: CriterionKind.LLM_JUDGE,
      preset: "task_fulfillment",
      score_threshold: 0.7,
    },
    ...overrides,
  };
}

Deno.test("[judge] the judge-bearing-step predicate selects exactly the steps that own an llm-judge criterion", () => {
  // Most shipped judge steps are `type: judge` and own the criterion.
  assertEquals(isJudgeBearingStep(judgeStep("judge-response", true)), true);
  // Nine shipped `type: judge` steps carry no judge criterion, so `type` is not the predicate.
  assertEquals(isJudgeBearingStep(judgeStep("step-durability-check", false)), false);

  // Other shipped scenarios carry the criterion on a json-assert or run-script step.
  const jsonAssert = ScenarioStepSchema.parse({
    id: "assert-quality",
    type: "json-assert",
    action_type: "agent.execution_completed",
    output_criteria: [{ id: "quality", kind: CriterionKind.LLM_JUDGE, rubric: "Grade the change." }],
  });
  assertEquals(isJudgeBearingStep(jsonAssert), true);

  const runScript = ScenarioStepSchema.parse({
    id: "score-report",
    type: "run-script",
    command: "deno",
    args: ["eval", "0"],
    output_criteria: [{ id: "quality", kind: CriterionKind.LLM_JUDGE, rubric: "Grade the report." }],
  });
  assertEquals(isJudgeBearingStep(runScript), true);
});

Deno.test("[judge] a judge step ref names the scenario, the step and its judge id", () => {
  const ref = buildJudgeStepRef("persona-eval", judgeStep("judge-response", true));
  assertEquals(ref.flowId, "persona-eval");
  assertEquals(ref.stepId, "judge-response");
  assertEquals(ref.kind, "judge");
  assertEquals(ref.judgeId, "judge-response");
  assertEquals(ref.nativeTools, false);
});

Deno.test("[judge] a judge binding resolves against the scenario layer stack, and judge:<id> overrides one step only", async () => {
  const dir = await Deno.makeTempDir({ prefix: "judge-bindings-" });
  try {
    const config = new ConfigService(await writeJudgeConfig(dir)).get();
    const steps = [judgeStep("judge-one", true), judgeStep("judge-two", true), judgeStep("no-judge", false)];
    const runFile = judgeRunFile({
      judge: { service: "judge-svc", model: "mock/judge-model" },
      "judge:judge-two": { model: "mock/judge-model-2" },
    });

    const plan = await resolveJudgeBindings({
      scenarioId: "persona-eval",
      steps,
      config,
      runFile,
      env: {},
    });

    // Only the judge-bearing steps resolve a binding.
    assertEquals([...plan.bindings.keys()].sort(), ["judge-one", "judge-two"]);
    assertEquals(plan.issues, []);

    const one = plan.bindings.get("judge-one")!;
    assertEquals(one.binding.service, "judge-svc");
    assertEquals(one.binding.model, "mock/judge-model");
    assertEquals(one.binding.sources.service?.selector, "judge");

    const two = plan.bindings.get("judge-two")!;
    assertEquals(two.binding.model, "mock/judge-model-2");
    assertEquals(two.binding.sources.model?.selector, "judge:judge-two");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A judge resolved to the DeepSeek service of the openai-chat adapter, as the catalog names it. */
const DEEPSEEK_JUDGE: IResolvedBinding = {
  service: "deepseek",
  model_provider: "deepseek",
  model: "deepseek/deepseek-v4-pro",
  service_model_id: "deepseek-v4-pro",
  transport: "cloud",
  interface: "api",
  adapter: "openai-chat",
  profile: "deepseek",
  sources: {},
  fingerprint: "d".repeat(64),
};

Deno.test("[judge] a judge on the same service and model as an openai-chat flow step is flagged judgeSharesSut", () => {
  // The config's [ai] block names the adapter, so it never matches the catalog service id.
  const sut = { aiProvider: "openai-chat", aiModel: "deepseek-v4-pro" };
  const boundStep = { service: "deepseek", model: "deepseek/deepseek-v4-pro" };

  assertEquals(judgeSharesSut(DEEPSEEK_JUDGE, { ...sut, boundSteps: [boundStep] }), true);
  assertEquals(
    judgeSharesSut(DEEPSEEK_JUDGE, {
      ...sut,
      boundSteps: [{ service: "claude-cli", model: "anthropic/claude-sonnet-5" }],
    }),
    false,
  );
  // With no bound step, the config's adapter and wire model are compared with the judge's.
  assertEquals(judgeSharesSut(DEEPSEEK_JUDGE, { ...sut, boundSteps: [] }), true);
  assertEquals(
    judgeSharesSut(DEEPSEEK_JUDGE, { aiProvider: "anthropic", aiModel: "claude-sonnet-5", boundSteps: [] }),
    false,
  );
});

Deno.test("[judge] an invalid judge binding fails the run and reports each issue", () => {
  const bindings = new Map();
  assertJudgeBindingsResolved({ bindings, issues: [] });

  const error = assertThrows(
    () =>
      assertJudgeBindingsResolved({
        bindings,
        issues: [{ stepId: "judge-one", code: "key_missing", detail: "Missing credential: JUDGE_KEY" }],
      }),
    BindingIncompatibleError,
  );
  assertEquals(error.issues[0].code, "key_missing");
  assertEquals(error.issues[0].stepId, "judge-one");
  assertStringIncludes(error.issues[0].detail, "JUDGE_KEY");
});

Deno.test("[judge] a judge whose service lacks its credential is reported by validation before grading", async () => {
  const dir = await Deno.makeTempDir({ prefix: "judge-bindings-key-" });
  try {
    const configPath = await writeJudgeConfig(dir);
    await Deno.writeTextFile(
      configPath,
      (await Deno.readTextFile(configPath)).replace('adapter = "mock"', 'adapter = "mock"\nkey_env = "JUDGE_KEY"'),
    );
    const config = new ConfigService(configPath).get();
    const input = {
      scenarioId: "persona-eval",
      steps: [judgeStep("judge-one", true)],
      config,
      runFile: judgeRunFile({ judge: { service: "judge-svc", model: "mock/judge-model" } }),
    };

    const missing = await resolveJudgeBindings({ ...input, env: {} });
    assertEquals(missing.bindings.size, 0);
    assertEquals(missing.issues.map((issue) => [issue.stepId, issue.code]), [["judge-one", "key_missing"]]);

    const present = await resolveJudgeBindings({ ...input, env: { JUDGE_KEY: "set" } });
    assertEquals(present.issues, []);
    assertEquals(present.bindings.get("judge-one")?.binding.service, "judge-svc");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[judge] a judge binding that cannot resolve is reported as an issue", async () => {
  const dir = await Deno.makeTempDir({ prefix: "judge-bindings-issue-" });
  try {
    const config = new ConfigService(await writeJudgeConfig(dir)).get();
    const plan = await resolveJudgeBindings({
      scenarioId: "persona-eval",
      steps: [judgeStep("judge-one", true)],
      config,
      runFile: judgeRunFile({ judge: { service: "missing-service", model: "mock/judge-model" } }),
      env: {},
    });

    assertEquals(plan.bindings.size, 0);
    assertEquals(plan.issues.map((issue) => [issue.stepId, issue.code]), [["judge-one", "unknown_service"]]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[judge] a bound judge grades with no EXA_EVAL_LLM_PROVIDER or EXA_LLM_PROVIDER env", async () => {
  const dir = await Deno.makeTempDir({ prefix: "judge-grade-" });
  try {
    const config = new ConfigService(await writeJudgeConfig(dir)).get();
    const plan = await resolveJudgeBindings({
      scenarioId: "persona-eval",
      steps: [judgeStep("judge-one", true)],
      config,
      runFile: judgeRunFile({ judge: { service: "judge-svc", model: "mock/judge-model" } }),
      env: {},
    });
    const binding = plan.bindings.get("judge-one")!.binding;

    await withEnv({ EXA_LLM_PROVIDER: null, EXA_EVAL_LLM_PROVIDER: null, EXA_EVAL_LLM_MODEL: null }, async () => {
      const seen: Array<{ provider: string; model: string }> = [];
      // Only the mock switch is set: no provider and no model come from the environment.
      const content = await callLlmEndpoint(
        "grade this",
        { EXA_EVAL_LLM_MOCK: "false" },
        undefined,
        (metadata) => {
          seen.push({ provider: metadata.provider, model: metadata.model });
        },
        binding,
      );

      assertEquals(typeof content, "string");
      assertEquals(seen, [{ provider: "mock", model: "mock/judge-model" }]);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[judge] the mock setting decides first, so a bound judge is not built while the mock answers", async () => {
  // A binding no factory can build. If the mock branch consulted it, this call would fail.
  const mocked = await evaluateLlmJudgeCriterion(
    judgeCriterionOptions({ env: { EXA_EVAL_LLM_MOCK: "pass" }, judgeBinding: UNBUILDABLE_BINDING }),
  );
  assertEquals(mocked.status, CriterionStatus.PASSED);

  // With the mock off the binding is consulted, so the unbuildable adapter surfaces.
  await assertRejects(
    () => callLlmEndpoint("grade this", { EXA_EVAL_LLM_MOCK: "false" }, undefined, undefined, UNBUILDABLE_BINDING),
    Error,
    "Unknown binding adapter",
  );
});

Deno.test("[judge][regression] with no judge binding the env path is unchanged", async () => {
  await withEnv({ EXA_LLM_PROVIDER: null, EXA_EVAL_LLM_PROVIDER: null, EXA_EVAL_LLM_MODEL: null }, async () => {
    // Today's guard still fires, and it still names the variable the caller must set.
    await assertRejects(
      () => callLlmEndpoint("grade this", { EXA_EVAL_LLM_MOCK: "false" }),
      Error,
      "EXA_LLM_PROVIDER",
    );
  });
});

const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");
const CELL_CATALOG_PATH = join(REPO_ROOT, "configs", "eval-cells.toml");

type CatalogEntry = Awaited<ReturnType<typeof loadScenarioCatalog>>[number];

/** Every binding selector one scenario declares, at scenario, step and matrix-cell level. */
function bindingSelectorsOf(scenario: CatalogEntry): string[] {
  const tables = [
    scenario.bindings,
    ...scenario.steps.map((step) => step.bindings),
    ...(scenario.matrix?.cells ?? []).map((cell) => cell.bindings),
  ];
  return tables.flatMap((table) => Object.keys(table ?? {}));
}

/** The one reviewed preset judge binding (Phase 203 Step 7, test-only fixture preset). */
const REVIEWED_JUDGE_BINDING_PRESETS = new Set(["self-hosted-fixture"]);

/** The merged agent-role scenarios Phase 203 Step 8 reviewed. Each binds its live cell's judge
 *  to the claude-cli delegate, so a live judge needs no provider credential. */
const REVIEWED_JUDGE_BINDING_SCENARIOS = new Set([
  "performance-engineer-smoke",
  "product-manager-smoke",
  "qa-engineer-smoke",
  "quality-judge-smoke",
  "security-expert-smoke",
  "senior-coder-smoke",
  "software-architect-smoke",
  "technical-writer-smoke",
  "test-engineer-smoke",
]);

Deno.test("[judge][regression] only the reviewed fixture preset declares a judge binding, so every other judge keeps its env path", async () => {
  const scenarios = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const offenders: string[] = [];
  const reviewedScenarios = new Set<string>();
  for (const scenario of scenarios) {
    for (const selector of bindingSelectorsOf(scenario)) {
      if (selector !== "judge" && !selector.startsWith("judge:")) continue;
      if (REVIEWED_JUDGE_BINDING_SCENARIOS.has(scenario.id)) {
        reviewedScenarios.add(`${scenario.id}: ${selector}`);
        continue;
      }
      offenders.push(`${scenario.id}: ${selector}`);
    }
  }

  // Phase 203 Step 7 reviewed exactly one preset judge binding.
  // The test-only `self-hosted-fixture` preset binds its judge to the claude-cli delegate.
  // That keeps the fixture cutover free of provider keys.
  // Every other preset and scenario must keep the environment path.
  const reviewed = new Set<string>();
  const cellCatalog = await loadCellCatalog(CELL_CATALOG_PATH);
  for (const [name, preset] of Object.entries(cellCatalog.presets)) {
    for (const selector of Object.keys(preset.bindings ?? {})) {
      if (selector !== "judge" && !selector.startsWith("judge:")) continue;
      if (REVIEWED_JUDGE_BINDING_PRESETS.has(name)) {
        reviewed.add(`${name}: ${selector}`);
        continue;
      }
      offenders.push(`preset ${name}: ${selector}`);
    }
  }

  // A judge binding on a shipped scenario or preset changes which judge grades it.
  // It also changes how a run reports that grade. That is a deliberate act.
  // This guard fails until the change is made and reviewed on purpose.
  assertEquals(offenders, []);
  assertEquals([...reviewed].sort(), ["self-hosted-fixture: judge"]);
  assertEquals(
    [...reviewedScenarios].sort(),
    [...REVIEWED_JUDGE_BINDING_SCENARIOS].map((id) => `${id}: judge`).sort(),
  );
  assert(scenarios.length >= 200, `the shipped scenario corpus must load, saw ${scenarios.length}`);
});

Deno.test("[judge] judgeSharesSut matches a bound step in catalog terms for every shipped service family", () => {
  const families: Array<Pick<IResolvedBinding, "service" | "model" | "adapter" | "service_model_id" | "profile">> = [
    {
      service: "openai",
      model: "openai/gpt-6-luna",
      adapter: "openai-chat",
      service_model_id: "gpt-6-luna",
      profile: "openai",
    },
    {
      service: "deepseek",
      model: "deepseek/deepseek-v4-pro",
      adapter: "openai-chat",
      service_model_id: "deepseek-v4-pro",
      profile: "deepseek",
    },
    {
      service: "self-hosted-fixture",
      model: "fixture/compat-fixture-v1",
      adapter: "openai-chat",
      service_model_id: "compat-fixture-v1",
      profile: "self-hosted",
    },
    {
      service: "ollama-chat",
      model: "meta/llama3.1:8b",
      adapter: "openai-chat",
      service_model_id: "llama3.1:8b",
      profile: "self-hosted",
    },
    {
      service: "claude-cli",
      model: "anthropic/claude-sonnet-5",
      adapter: "claude-cli",
      service_model_id: "claude-sonnet-5",
    },
    {
      service: "anthropic",
      model: "anthropic/claude-sonnet-5",
      adapter: "anthropic",
      service_model_id: "claude-sonnet-5",
    },
  ];
  for (const family of families) {
    const judge: IResolvedBinding = { ...DEEPSEEK_JUDGE, ...family };
    const boundSteps = [{ service: family.service, model: family.model }];
    assertEquals(judgeSharesSut(judge, { boundSteps }), true, family.service);
    assertEquals(
      judgeSharesSut(judge, { boundSteps: [{ service: "mock", model: "mock/other" }] }),
      false,
      family.service,
    );
  }
});
