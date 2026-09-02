/**
 * @module ScratchpadExtractionTest
 * @path packages/memory/tests/extraction/scratchpad_extraction_test.ts
 * @description Verifies LlmLearningExtractor reads the execution's scratchpad as additional
 * extraction input (mock provider) and does not double-extract insights that appear in both
 * the scratchpad and lessons_learned.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

import { LlmLearningExtractor } from "@exaix/memory";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_INSTRUCTIONS = "Reject structural-only facts such as import-graph statements.";

/** Scripted provider: first call records the prompt; the response is the canned extraction JSON. */
class StubProvider implements IModelProvider {
  id = "scratchpad-extraction-test";
  prompt = "";
  constructor(private content: string) {}
  generate(prompt: string) {
    this.prompt = prompt;
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0.004,
    });
  }
}

function makeSkills() {
  return castAny<ISkillsService>({
    getSkill: (skillId: string) =>
      Promise.resolve(
        skillId === "memory-extraction-content-policy"
          ? { skill_id: skillId, instructions: POLICY_INSTRUCTIONS }
          : null,
      ),
  });
}

function makeRouter() {
  return castAny<IMemoryCostRouter>({ recordOperation: () => Promise.resolve() });
}

Deno.test("LlmLearningExtractor: a scratchpad entry not mentioned in lessons_learned is captured as a learning", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const scratchpad = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();
    await scratchpad.appendNote(traceId, "Rate limiter resets on full restart, not per request", ["gotcha"]);
    const execution = createMinimalExecutionMemory({
      trace_id: traceId,
      lessons_learned: ["An unrelated post-run lesson"],
    });

    const provider = new StubProvider(JSON.stringify({
      learnings: [{
        title: "Rate limiter resets on full restart",
        description: "Backoff must be process-lifetime aware.",
        category: "insight",
        tags: ["gotcha"],
        quality_score: 0.8,
      }],
    }));
    const extractor = new LlmLearningExtractor(provider, makeSkills(), makeRouter(), scratchpad);
    const learnings = await extractor.extract(execution);

    assertEquals(learnings.length, 1);
    assertEquals(learnings[0].title, "Rate limiter resets on full restart");
    assertStringIncludes(provider.prompt, "Rate limiter resets on full restart, not per request");
    assertStringIncludes(provider.prompt, "<untrusted_scratchpad>");
  } finally {
    await cleanup();
  }
});

Deno.test("LlmLearningExtractor: an insight present in both scratchpad and lessons_learned is not double-extracted", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const scratchpad = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();
    const shared = "Avoid caching stale portal config between runs";
    await scratchpad.appendNote(traceId, shared);
    const execution = createMinimalExecutionMemory({
      trace_id: traceId,
      lessons_learned: [shared],
    });

    const provider = new StubProvider(JSON.stringify({
      learnings: [
        {
          title: shared,
          description: "From lessons_learned.",
          category: "anti-pattern",
          tags: [],
          quality_score: 0.7,
        },
        {
          title: "avoid   caching  STALE portal config between runs!",
          description: "From the scratchpad entry.",
          category: "anti-pattern",
          tags: [],
          quality_score: 0.7,
        },
      ],
    }));
    const extractor = new LlmLearningExtractor(provider, makeSkills(), makeRouter(), scratchpad);
    const learnings = await extractor.extract(execution);

    assertEquals(learnings.length, 1, "cross-source duplicates must collapse to one candidate");
    assertStringIncludes(provider.prompt, "emit it once");
  } finally {
    await cleanup();
  }
});
