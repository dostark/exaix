/**
 * @module Ste100PromptIntegrationTest
 * @path packages/execution/tests/ste100_prompt_integration_test.ts
 * @description Phase 195 Step 1 + Step 4 — RED-first integration tests proving the
 *   compiled STE contract reaches the provider prompt through the real production runner
 *   chain: `scripts/build_skills_index.ts` compiles the review-written fixture and real
 *   Blueprint skills to real skill JSON, `SkillsService.getSkill` loads them,
 *   `AgentRunner.run` hydrates through
 *   `renderSkillsSection`/`renderCriticalSkillsSection` (the production formatter), and a
 *   capturing provider records the assembled prompt. Asserts the canonical rule, the five
 *   Exaix extension rules, the structured/thought-section contract, the documentation
 *   exemption with status-prose coverage, metadata-only body delivery, real agent bodies
 *   carrying the compact rule with no skill context, critical-contract survival under
 *   budget pressure, judge/specialist JSON shapes, identity metadata preservation, and
 *   trimmed-mode obligations — none of which route through `SkillsService.buildSkillContext`.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/blueprint_service.ts",
 *   "packages/core/src/func/prompt_formatter.ts",
 *   "packages/core/src/skills/skills.ts",
 *   "scripts/build_skills_index.ts"
 * ]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  AgentRunner,
  BlueprintService,
  ContextBudgetManager,
  type IBlueprint,
  type IParsedRequest,
} from "@exaix/execution";
import { SkillsService } from "@exaix/core/skills";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import { PromptBudgetAllocator } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig, createMockLogger, initTestDbService, REPO_ROOT } from "@exaix/testing";
import { buildSkillsIndex } from "../../../scripts/build_skills_index.ts";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";
const FIXTURE_SKILLS_DIR = join(import.meta.dirname!, "../../../tests/scenario_framework/fixtures/ste100/skills");
const REAL_SKILLS_DIR = join(REPO_ROOT, "Blueprints", "Skills");

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

/** Compiles a skills directory into a fresh temp Memory/Skills store via the production
 *  generator, then returns the temp root. Used by the tests that load the real Blueprint
 *  skill catalog (the same sources the daemon compiles). */
async function compileSkillsToTempStore(skillsDir: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "ste100-corpus-" });
  const memoryDir = join(root, "Memory");
  const targetSkillsDir = join(memoryDir, "Skills");
  const generated = await buildSkillsIndex(skillsDir, targetSkillsDir, root);
  if (!generated.success) {
    await Deno.remove(root, { recursive: true }).catch(() => {});
    throw new Error(`buildSkillsIndex failed: ${generated.errors.join("; ")}`);
  }
  return root;
}

/** Runs a real Blueprint skill through the full chain — compile → SkillsService →
 *  AgentRunner.run with a real ContextBudgetManager → capturing provider — and returns
 *  the assembled provider prompt. `pinSkillIds` mirrors a request's explicit skills. */
async function captureRealSkillPrompt(
  pinSkillIds: string[],
  options?: { costTargetTokens?: number; render_mode?: "full" | "trimmed"; requestText?: string },
): Promise<{ prompt: string; skill: ISkill | null }> {
  const root = await compileSkillsToTempStore(REAL_SKILLS_DIR);
  const memoryDir = join(root, "Memory");
  try {
    const { db, cleanup } = await initTestDbService();
    try {
      const skillsService = new SkillsService({ memoryDir }, db);
      await skillsService.initialize();

      const skill = pinSkillIds.length > 0 && pinSkillIds[0] ? await skillsService.getSkill(pinSkillIds[0]) : null;

      const logger = new EventLogger({ db });
      const contextBudgetManager = new ContextBudgetManager(undefined, undefined, undefined, logger);
      const promptBudgetAllocator = options?.costTargetTokens !== undefined
        ? new PromptBudgetAllocator({ costTargetTokens: options.costTargetTokens })
        : new PromptBudgetAllocator();

      const { provider, prompts } = makeCapturingProvider([WELL_FORMED_RESPONSE]);
      const context = options?.render_mode
        ? ({ config: { get: () => ({ skills: { render_mode: options.render_mode } }) } } as never)
        : undefined;
      const runner = new AgentRunner(undefined, provider, {
        logger,
        skillsService,
        disableSkills: false,
        contextBudgetManager,
        promptBudgetAllocator,
        context,
      });
      const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
      const request: IParsedRequest = {
        userPrompt: options?.requestText ?? "Do the thing.",
        context: {},
        skills: pinSkillIds,
      };

      await runner.run(blueprint, request, undefined);
      assertEquals(prompts.length, 1, "exactly one provider call for the planning prompt");
      return { prompt: prompts[0], skill };
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

/** Loads a real Blueprint agent body (the exact file the daemon turns into
 *  systemPrompt) through the real BlueprintService. */
async function loadRealAgentSystemPrompt(agentName: string): Promise<string> {
  const config = createMockConfig(REPO_ROOT);
  const service = new BlueprintService(config, createMockLogger());
  const { blueprint } = await service.loadBlueprint(agentName);
  return blueprint.systemPrompt;
}

/** Builds a capturing provider around the same contract as the other helpers, but for the
 *  AgentRunner instance used by the agent-body test (needs no skills service). */
async function captureAgentBodyPrompt(systemPrompt: string): Promise<string> {
  const { provider, prompts } = makeCapturingProvider([WELL_FORMED_RESPONSE]);
  const runner = new AgentRunner(undefined, provider, { disableSkills: true });
  const blueprint: IBlueprint = { systemPrompt };
  const request: IParsedRequest = { userPrompt: "Explain the login flow.", context: {} };
  await runner.run(blueprint, request, undefined);
  assertEquals(prompts.length, 1, "exactly one provider call for the planning prompt");
  return prompts[0];
}

Deno.test("Runtime agent body carries STE when skill context is absent", async () => {
  const systemPrompt = await loadRealAgentSystemPrompt("default");
  assertStringIncludes(systemPrompt, "Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.");
  assertStringIncludes(systemPrompt, "Exempt documentation deliverables.");

  const prompt = await captureAgentBodyPrompt(systemPrompt);
  assertStringIncludes(prompt, "Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.");
  assertStringIncludes(prompt, "Exempt documentation deliverables.");
});

Deno.test("Critical response guidance survives context budget pressure", async () => {
  // A tight cost ceiling forces compaction, but the critical (protected) segment — the
  // response contract — must survive verbatim.
  const { prompt, skill } = await captureRealSkillPrompt(["response-contract"], {
    costTargetTokens: 50_000,
    requestText: "Do the thing.",
  });
  assertEquals(skill !== null, true);
  assertEquals(
    skill!.instructions.includes("ASD-STE100"),
    false,
    "the STE rule lives in the agent body, not the skill",
  );
  assertStringIncludes(prompt, "## Agent Thought Standardization");
  assertStringIncludes(prompt, "REQUIRED SKILLS & CONTRACT");
});

Deno.test("Judge and specialist contracts preserve their exact JSON shapes", async () => {
  const judge = await captureRealSkillPrompt(["response-contract-judge"]);
  assertStringIncludes(judge.skill!.instructions, '"criteriaScores"');
  assertStringIncludes(judge.skill!.instructions, '"overallScore"');
  assertStringIncludes(judge.skill!.instructions, '"reasoning"');
  assertStringIncludes(judge.skill!.instructions, '"issues"');

  const specialist = await captureRealSkillPrompt(["response-contract-security-analysis"]);
  assertStringIncludes(specialist.skill!.instructions, '"findings"');
  assertStringIncludes(specialist.skill!.instructions, '"severity"');
});

Deno.test("Compiled skills preserve identity metadata and instruction semantics", async () => {
  const { skill } = await captureRealSkillPrompt(["response-contract"]);
  assertEquals(skill?.skill_id, "response-contract");
  assertEquals(skill?.name, "Response Output Contract");
  assertEquals(skill?.critical, true);
  assertStringIncludes(skill!.instructions, "## Executable-plan JSON schema");
  assertStringIncludes(skill!.instructions, "## Agent Thought Standardization");
});

Deno.test("Blueprint skill compression preserves obligations through compilation and loading", async () => {
  // A real converted Blueprint skill, compiled + loaded, still carries its required
  // obligations (not just generic STE labels).
  const { prompt } = await captureRealSkillPrompt(["response-contract"]);
  assertStringIncludes(prompt, "MUST be a single valid JSON object");
  assertStringIncludes(prompt, "Never wrap the JSON in a markdown code fence");
});

Deno.test("Loaded skill context includes all required instructions after deduplication", async () => {
  // Two skills with overlapping triggers load together with BOTH bodies rendered — the
  // hydration path must not drop one skill's required instructions as a "duplicate".
  const { prompt } = await captureRealSkillPrompt(["response-contract", "response-contract-judge"]);
  assertStringIncludes(prompt, "## Agent Thought Standardization");
  assertStringIncludes(prompt, "## How to judge");
});

Deno.test("Runtime obligation mapping forbids deduplication into unrendered metadata", async () => {
  // The metadata-only fixture proves obligations survive in the body; the mapped skill
  // must not be delivered via `constraints`/`output_requirements` (unrendered by the real
  // fort matter). The Body instructions must carry the obligation text.
  const root = await compileSkillsToTempStore(FIXTURE_SKILLS_DIR);
  const memoryDir = join(root, "Memory");
  try {
    const { db, cleanup } = await initTestDbService();
    try {
      const skillsService = new SkillsService({ memoryDir }, db);
      await skillsService.initialize();
      const { provider, prompts } = makeCapturingProvider([WELL_FORMED_RESPONSE]);
      const runner = new AgentRunner(undefined, provider, { skillsService, disableSkills: false });
      const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
      const request: IParsedRequest = {
        userPrompt: "Summarize the result.",
        context: {},
        skills: ["ste-metadata-only"],
      };
      await runner.run(blueprint, request, undefined);
      const prompt = prompts[0];
      assertStringIncludes(prompt, "## Reviewed body equivalent");
      assertEquals(prompt.includes("output_requirements:"), false);
      assertEquals(prompt.includes("constraints:"), false);
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Trimmed ordinary skill still carries its reviewed obligations", async () => {
  // render_mode=trimmed strips only the Examples section; body obligations must survive.
  const { prompt } = await captureRealSkillPrompt(["response-contract"], { render_mode: "trimmed" });
  assertStringIncludes(prompt, "## Agent Thought Standardization");
  assertStringIncludes(prompt, "## Executable-plan JSON schema");
});
