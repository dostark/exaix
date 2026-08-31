/**
 * @module ScenarioFrameworkJudgeMethodologyInjectionTest
 * @path tests/scenario_framework/tests/unit/judge_methodology_injection_test.ts
 * @description Tests for injecting the catalog's own judge-methodology skills
 * (verdict-rubric, response-contract-judge) into the LLM-judge prompt. A live-observed
 * 10-trial noise-floor test on identical evidence produced scores from
 * 0.19 to 0.98 (stdev 0.32), including outright hallucinated claims ("no null check at
 * all" on code that demonstrably has one) — the judge prompt never referenced these two
 * `critical: true`, `usage_count: 0` skills that exist specifically to fix this
 * (evidence-grounded, reason-before-score methodology). Reads the skill JSON files
 * directly rather than going through SkillsService/AgentRunner — the judge path is
 * deliberately DB-less and daemon-less (assertions.ts's own callLlmEndpoint comment),
 * and routing it through AgentRunner risks EXA_EVAL_SUPPRESS_SKILLS leaking from the
 * arm under test into the judge's own skill resolution in the same process.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadJudgeMethodologyInstructions, prependMethodologyInstructions } from "../../runner/assertions.ts";

async function writeSkillFixture(dir: string, skillId: string, instructions: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/${skillId}.json`,
    JSON.stringify({ skill_id: skillId, instructions }),
  );
}

Deno.test("[JudgeMethodologyInjection] loads and concatenates both methodology skills' instructions", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-methodology-" });
  try {
    const skillsDir = `${workspaceRoot}/Memory/Skills/global`;
    await writeSkillFixture(skillsDir, "verdict-rubric", "RUBRIC INSTRUCTIONS TEXT");
    await writeSkillFixture(skillsDir, "response-contract-judge", "CONTRACT INSTRUCTIONS TEXT");

    const methodology = await loadJudgeMethodologyInstructions(workspaceRoot);
    assertStringIncludes(methodology, "RUBRIC INSTRUCTIONS TEXT");
    assertStringIncludes(methodology, "CONTRACT INSTRUCTIONS TEXT");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeMethodologyInjection] a missing skill file degrades gracefully (empty contribution), matching resolveEvalJudgeContext's fallback convention", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-methodology-missing-" });
  try {
    const skillsDir = `${workspaceRoot}/Memory/Skills/global`;
    await writeSkillFixture(skillsDir, "verdict-rubric", "RUBRIC ONLY");
    // response-contract-judge.json intentionally absent.

    const methodology = await loadJudgeMethodologyInstructions(workspaceRoot);
    assertStringIncludes(methodology, "RUBRIC ONLY");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeMethodologyInjection] both skills missing returns an empty string, not a throw", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-methodology-none-" });
  try {
    const methodology = await loadJudgeMethodologyInstructions(workspaceRoot);
    assertEquals(methodology, "");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeMethodologyInjection] prependMethodologyInstructions puts methodology before the evaluation request, unchanged when methodology is empty", () => {
  const prompt = "## Evaluation Request\n...";
  assertEquals(prependMethodologyInstructions(prompt, ""), prompt);

  const withMethodology = prependMethodologyInstructions(prompt, "REASON FIRST, SCORE SECOND");
  assertStringIncludes(withMethodology, "REASON FIRST, SCORE SECOND");
  const methodologyIndex = withMethodology.indexOf("REASON FIRST, SCORE SECOND");
  const requestIndex = withMethodology.indexOf("## Evaluation Request");
  assertEquals(methodologyIndex < requestIndex, true);
});
