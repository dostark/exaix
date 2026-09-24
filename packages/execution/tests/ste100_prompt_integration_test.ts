/**
 * @module Ste100PromptIntegrationTest
 * @path packages/execution/tests/ste100_prompt_integration_test.ts
 * @description Phase 195 Step 1 — RED-first integration tests proving the compiled
 *   STE contract reaches the provider prompt through the real production runner chain:
 *   `scripts/build_skills_index.ts` compiles the review-written fixture skills to real
 *   skill JSON, `SkillsService.getSkill` loads them, `AgentRunner.run` hydrates through
 *   `renderSkillsSection`/`renderCriticalSkillsSection` (the production formatter), and a
 *   capturing provider records the assembled prompt. Asserts the canonical rule, the five
 *   Exaix extension rules, the structured/thought-section contract, the documentation
 *   exemption with status-prose coverage, and metadata-only body delivery — none of which
 *   route through `SkillsService.buildSkillContext`.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/core/src/func/prompt_formatter.ts",
 *   "packages/core/src/skills/skills.ts",
 *   "scripts/build_skills_index.ts"
 * ]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { buildSkillsIndex } from "../../../scripts/build_skills_index.ts";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";
const FIXTURE_SKILLS_DIR = join(import.meta.dirname!, "../../../tests/scenario_framework/fixtures/ste100/skills");

/** Records every prompt it is sent and returns scripted responses — the capturing
 *  provider pattern used across execution tests. */
function makeCapturingProvider(responses: string[]): {
  provider: IModelProvider;
  prompts: string[];
} {
  const prompts: string[] = [];
  let callCount = 0;
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate(prompt: string): Promise<IGenerateResult> {
      prompts.push(prompt);
      const response = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return Promise.resolve({
        content: response,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, prompts };
}

/** Compiles the real fixture skills into a fresh temp skill store via the production
 *  generator, then drives `AgentRunner.run` with a capturing provider, returning the
 *  assembled provider prompt. */
async function captureContractPrompt(userPrompt: string, pinnedSkillIds: string[]): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "ste100-prompt-" });
  const memoryDir = join(root, "Memory");
  const targetSkillsDir = join(memoryDir, "Skills");
  try {
    const generated = await buildSkillsIndex(FIXTURE_SKILLS_DIR, targetSkillsDir, root);
    if (!generated.success) {
      throw new Error(`buildSkillsIndex failed: ${generated.errors.join("; ")}`);
    }
    assertEquals(generated.generated.length, 2, "both contract fixtures must compile");

    const { db, cleanup } = await initTestDbService();
    try {
      const skillsService = new SkillsService({ memoryDir }, db);
      await skillsService.initialize();

      const { provider, prompts } = makeCapturingProvider([WELL_FORMED_RESPONSE]);
      const runner = new AgentRunner(undefined, provider, { skillsService, disableSkills: false });
      const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
      const request: IParsedRequest = { userPrompt, context: {}, skills: pinnedSkillIds };

      await runner.run(blueprint, request, undefined);
      assertEquals(prompts.length, 1, "exactly one provider call for the planning prompt");
      return prompts[0];
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("STE runtime contract reaches AgentRunner from compiled skill", async () => {
  const prompt = await captureContractPrompt("Explain the login flow.", ["ste-contract"]);
  assertStringIncludes(prompt, "# STE Contract for Agent Prose");
  assertStringIncludes(prompt, "**Instructions:**");
  assertStringIncludes(prompt, "## Canonical Communication requirement");
  assertStringIncludes(prompt, "Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.");
  assertStringIncludes(prompt, "## Exaix STE Extension v1");
});

Deno.test("STE preserves structured content and required thought sections", async () => {
  const prompt = await captureContractPrompt("Do the thing.", ["ste-contract"]);
  assertStringIncludes(prompt, "## Reserved structured content contract");
  for (const marker of ["<thought>", "<content>", "Tags metadata block", "raw JSON body"]) {
    assertStringIncludes(prompt, marker);
  }
  // The skill's own tags survive through the production formatter's tags line.
  assertStringIncludes(prompt, "*Tags:");
  assertStringIncludes(prompt, "communication");
});

Deno.test("Documentation content is exempt while status prose is covered", async () => {
  const technicalWriting = await captureContractPrompt(
    "Write the user guide section for the new flag.",
    ["ste-contract"],
  );
  assertStringIncludes(technicalWriting, "Exempt documentation deliverables.");

  const explanation = await captureContractPrompt(
    "Explain why the check failed and what to run next.",
    ["ste-contract"],
  );
  assertStringIncludes(explanation, "## Status prose coverage");
  assertStringIncludes(explanation, "Cover status prose and normal explanations");
});

Deno.test("Compiled contract carries all five Exaix extension rules", async () => {
  const prompt = await captureContractPrompt("Do the thing.", ["ste-contract"]);
  for (const ruleId of ["EXAIX-01", "EXAIX-02", "EXAIX-03", "EXAIX-04", "EXAIX-05"]) {
    assertStringIncludes(prompt, ruleId);
  }
  assertStringIncludes(prompt, "Lead with the answer, result, or next required action.");
  assertStringIncludes(prompt, "Prefer useful bullet lists to long prose.");
});

Deno.test("Metadata-only obligation survives through the unchanged production formatter", async () => {
  const prompt = await captureContractPrompt("Summarize the result.", ["ste-metadata-only"]);
  // The reviewed body equivalent is delivered by the real formatter over the body…
  assertStringIncludes(prompt, "## Reviewed body equivalent");
  assertStringIncludes(prompt, "Response must keep the required action first.");
  assertStringIncludes(prompt, "Confirm unresolved requirements remain pending.");
  // …via the instructions body, not a metadata dump (the metadata lists themselves must
  // not be rendered; only the body's prose mention of them may appear).
  assertStringIncludes(prompt, "**Instructions:**");
  assertEquals(prompt.includes("output_requirements:"), false);
  assertEquals(prompt.includes('"output_requirements"'), false);
});
