/**
 * @module ScenarioJudgeConfigTest
 * @path tests/scenario_framework/tests/unit/judge_config_test.ts
 * @description Tests the scenario-level `judge:` config: the schema accepts it, and the
 *   framework injects it into judge steps (and any step carrying an `llm-judge` criterion) as
 *   EXA_LLM_PROVIDER/EXA_LLM_MODEL so scenarios never hardcode a judge model in the step env.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { type IScenarioStep, ScenarioStepType } from "../../schema/step_schema.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { injectScenarioJudgeEnv, stepCarriesLlmJudge } from "../../runner/synthetic_runner.ts";

function step(overrides: Partial<IScenarioStep> = {}): IScenarioStep {
  return {
    id: "judge-quality",
    type: ScenarioStepType.JUDGE,
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
    ...overrides,
  } as IScenarioStep;
}

Deno.test("[judge-config] scenario schema accepts a judge block and rejects unknown keys", () => {
  const parsed = ScenarioSchema.parse(
    parseYaml(`schema_version: "1.0.0"
id: "judge-config"
title: "Judge config"
pack: "swe_tasks"
tags: ["swe"]
request_fixture: "fixtures/requests/swe_tasks/x.md"
mode_support: ["auto"]
portals: []
judge:
  provider: "opencode-cli"
  model: "opencode-go/deepseek-v4-flash"
steps:
  - id: "judge-quality"
    type: "judge"
    output_criteria:
      - id: "llm-judge-quality"
        kind: "llm-judge"
        preset: "GOAL_ALIGNED_REVIEW"
`),
  );
  assertEquals(parsed.judge?.provider, "opencode-cli");
  assertEquals(parsed.judge?.model, "opencode-go/deepseek-v4-flash");

  const invalid = ScenarioSchema.safeParse(
    parseYaml(`schema_version: "1.0.0"
id: "judge-config"
title: "Judge config"
pack: "swe_tasks"
tags: ["swe"]
request_fixture: "fixtures/requests/swe_tasks/x.md"
mode_support: ["auto"]
portals: []
judge:
  provider: "opencode-cli"
  model: 42
steps:
  - id: "judge-quality"
    type: "judge"
`),
  );
  assertEquals(invalid.success, false, "judge.model must be a string");
});

Deno.test("[judge-config] a judge step (or any llm-judge criterion) carries the judge", () => {
  assertEquals(stepCarriesLlmJudge(step()), true, "judge step type");
  assertEquals(stepCarriesLlmJudge(step({ type: ScenarioStepType.JSON_ASSERT })), false, "no llm-judge criterion");
  assertEquals(
    stepCarriesLlmJudge(step({
      type: ScenarioStepType.JSON_ASSERT,
      output_criteria: [{ id: "llm", kind: "llm-judge", preset: "GOAL_ALIGNED_REVIEW" }],
    })),
    true,
    "json-assert step with an llm-judge criterion",
  );
});

Deno.test("[judge-config] scenario judge config is injected into a judge step's env", () => {
  const env: Record<string, string> = { EXA_EVAL_LLM_MOCK: "false" };
  injectScenarioJudgeEnv(env, step(), {}, { provider: "opencode-cli", model: "opencode-go/deepseek-v4-flash" });
  assertEquals(env.EXA_LLM_PROVIDER, "opencode-cli");
  assertEquals(env.EXA_LLM_MODEL, "opencode-go/deepseek-v4-flash");
  assertEquals(env.EXA_EVAL_LLM_MOCK, "false", "other env keys are untouched");
});

Deno.test("[judge-config] a step env that already sets the provider/model wins", () => {
  const env: Record<string, string> = {
    EXA_LLM_PROVIDER: "anthropic",
    EXA_LLM_MODEL: "claude-sonnet",
  };
  injectScenarioJudgeEnv(env, step(), {}, { provider: "opencode-cli", model: "opencode-go/deepseek-v4-flash" });
  assertEquals(env.EXA_LLM_PROVIDER, "anthropic");
  assertEquals(env.EXA_LLM_MODEL, "claude-sonnet");
});

Deno.test("[judge-config] matrix cells resolve $CELL_* tokens in the judge config", () => {
  const env: Record<string, string> = {};
  injectScenarioJudgeEnv(
    env,
    step(),
    { CELL_PROVIDER: "opencode", CELL_MODEL: "opencode-go/deepseek-v4-flash" },
    { provider: "$CELL_PROVIDER", model: "$CELL_PROVIDER:$CELL_MODEL" },
  );
  assertEquals(env.EXA_LLM_PROVIDER, "opencode");
  assertEquals(env.EXA_LLM_MODEL, "opencode:opencode-go/deepseek-v4-flash");
});

Deno.test("[judge-config] no judge config or a non-judge step leaves the env untouched", () => {
  const env: Record<string, string> = {};
  injectScenarioJudgeEnv(env, step(), {}, undefined);
  assertEquals(env.EXA_LLM_PROVIDER, undefined);

  const env2: Record<string, string> = {};
  injectScenarioJudgeEnv(env2, step({ type: ScenarioStepType.EXACTL }), {}, {
    provider: "opencode-cli",
    model: "x",
  });
  assertEquals(env2.EXA_LLM_PROVIDER, undefined, "non-judge steps get no judge env");
});
