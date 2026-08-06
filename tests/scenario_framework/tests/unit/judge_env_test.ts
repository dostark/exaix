/**
 * @module ScenarioJudgeEnvTest
 * @path tests/scenario_framework/tests/unit/judge_env_test.ts
 * @description Tests the env-driven LLM judge model resolution: `exactl eval`/scenario judge
 *   steps read EXA_EVAL_LLM_PROVIDER/EXA_EVAL_LLM_MODEL (dedicated judge vars, so the judge
 *   model can differ from the scenario's own execution model), falling back to
 *   EXA_LLM_PROVIDER/EXA_LLM_MODEL, then EXA_EVAL_MODEL_SIZE. No judge model is hardcoded in
 *   scenario YAML.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */

import { assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { resolveEvalJudgeProvenance } from "../../runner/assertions.ts";

Deno.test("[judge-env] dedicated EXA_EVAL_LLM_* vars win over the scenario's own model", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "opencode-cli", EXA_LLM_MODEL: "opencode-go/deepseek-v4-flash" }, () => {
    const resolved = resolveEvalJudgeProvenance({
      EXA_EVAL_LLM_PROVIDER: "anthropic",
      EXA_EVAL_LLM_MODEL: "claude-sonnet-4-5",
    });
    assertEquals(resolved, { provider: "anthropic", model: "claude-sonnet-4-5" });
  });
});

Deno.test("[judge-env] without dedicated vars the judge falls back to the scenario's own model", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "opencode-cli", EXA_LLM_MODEL: "opencode-go/deepseek-v4-flash" }, () => {
    assertEquals(resolveEvalJudgeProvenance({}), {
      provider: "opencode-cli",
      model: "opencode-go/deepseek-v4-flash",
    });
  });
});

Deno.test("[judge-env] a step env EXA_LLM_* also serves as the fallback", () => {
  const resolved = resolveEvalJudgeProvenance({
    EXA_LLM_PROVIDER: "anthropic",
    EXA_LLM_MODEL: "claude-sonnet-4-5",
  });
  assertEquals(resolved, { provider: "anthropic", model: "claude-sonnet-4-5" });
});

Deno.test("[judge-env] provider without a model falls back to EXA_EVAL_MODEL_SIZE, then the provider", () => {
  assertEquals(
    resolveEvalJudgeProvenance({ EXA_LLM_PROVIDER: "anthropic", EXA_EVAL_MODEL_SIZE: "claude-sonnet-4-5" }),
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
  );
  assertEquals(resolveEvalJudgeProvenance({ EXA_LLM_PROVIDER: "anthropic" }), {
    provider: "anthropic",
    model: "anthropic",
  });
});

Deno.test("[judge-env] no provider configured resolves to undefined", () => {
  assertEquals(resolveEvalJudgeProvenance({}), undefined);
});
