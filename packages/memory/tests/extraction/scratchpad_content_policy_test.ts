/**
 * @module ScratchpadContentPolicyTest
 * @path packages/memory/tests/extraction/scratchpad_content_policy_test.ts
 * @description Verifies scratchpad-derived candidates are subject to Step 1's
 * memory-extraction-content-policy skill identically to any other extraction candidate: the
 * policy instructions and the scratchpad block share the same prompt, and a scratchpad entry
 * that merely restates a portal-knowledge structural fact yields no learning (mock provider
 * obeys the policy by omitting it).
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";

import { LlmLearningExtractor, ScratchpadService } from "@exaix/memory";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_INSTRUCTIONS =
  "Deprioritize structural-only facts such as 'File A imports File B.' — relationships are answerable by query_relationships/who_depends_on.";

class PolicyObeyingStubProvider implements IModelProvider {
  id = "scratchpad-policy-test";
  prompt = "";
  generate(prompt: string) {
    this.prompt = prompt;
    // The provider obeys the injected policy: the structural-fact scratchpad entry is omitted,
    // only the genuine insight is extracted — identically to how any other candidate is filtered.
    const content = JSON.stringify({
      learnings: [{
        title: "Config reload needs an explicit invalidation hook",
        description: "Structural graph facts are queryable on demand; the missing hook is the real insight.",
        category: "insight",
        tags: [],
        quality_score: 0.75,
      }],
    });
    return Promise.resolve({
      content,
      usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0.001,
    });
  }
}

Deno.test("scratchpad candidates pass Step 1's content-curation skill identically to any other candidate", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const scratchpad = new ScratchpadService(config);
    const traceId = crypto.randomUUID();
    await scratchpad.append(traceId, "File main.ts imports util.ts internally");
    await scratchpad.append(traceId, "Config reload needs an explicit invalidation hook");
    const execution = createMinimalExecutionMemory({ trace_id: traceId });

    const provider = new PolicyObeyingStubProvider();
    const skills = castAny<ISkillsService>({
      getSkill: (skillId: string) =>
        Promise.resolve(
          skillId === "memory-extraction-content-policy"
            ? { skill_id: skillId, instructions: POLICY_INSTRUCTIONS }
            : null,
        ),
    });
    const extractor = new LlmLearningExtractor(
      provider,
      skills,
      castAny<IMemoryCostRouter>({ recordOperation: () => Promise.resolve() }),
      scratchpad,
    );
    const learnings = await extractor.extract(execution);

    assertStringIncludes(provider.prompt, POLICY_INSTRUCTIONS, "policy must be injected for scratchpad input too");
    assertStringIncludes(provider.prompt, "File main.ts imports util.ts internally");
    assertEquals(learnings.length, 1, "structural-fact entry must be rejected by the policy, insight kept");
    assertEquals(learnings[0].title, "Config reload needs an explicit invalidation hook");
    assertExists(learnings[0].id);
    assertEquals(learnings[0].source_id, traceId);
  } finally {
    await cleanup();
  }
});
