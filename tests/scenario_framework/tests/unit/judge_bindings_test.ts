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

import { assert, assertEquals, assertRejects } from "@std/assert";
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
import { buildJudgeStepRef, isJudgeBearingStep, resolveJudgeBindings } from "../../runner/judge_bindings.ts";

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

    // The two judges share one service, so neither is flagged against the system under test.
    assertEquals(one.judgeSharesSut, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[judge] a judge bound to the system under test's own service and model is flagged judge_shares_sut", async () => {
  const dir = await Deno.makeTempDir({ prefix: "judge-shares-sut-" });
  try {
    const config = new ConfigService(await writeJudgeConfig(dir)).get();
    const plan = await resolveJudgeBindings({
      scenarioId: "persona-eval",
      steps: [judgeStep("judge-one", true)],
      config,
      runFile: judgeRunFile({ judge: { service: "judge-svc", model: "mock/judge-model" } }),
      env: {},
      sut: { service: "judge-svc", model: "mock/judge-model" },
    });

    assertEquals(plan.bindings.get("judge-one")?.judgeSharesSut, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[judge] a judge binding that cannot resolve is reported and keeps the judge on the env path", async () => {
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

Deno.test("[judge][regression] only the reviewed fixture preset declares a judge binding, so every other judge keeps its env path", async () => {
  const scenarios = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const offenders: string[] = [];
  for (const scenario of scenarios) {
    for (const selector of bindingSelectorsOf(scenario)) {
      if (selector === "judge" || selector.startsWith("judge:")) {
        offenders.push(`${scenario.id}: ${selector}`);
      }
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
  assert(scenarios.length >= 200, `the shipped scenario corpus must load, saw ${scenarios.length}`);
});
