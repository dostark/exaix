/**
 * @module LlmLearningExtractorTest
 * @path packages/memory/tests/extraction/llm_extractor_test.ts
 * @description Verifies typed, policy-guided LLM learning extraction and quality scoring.
 * @architectural-layer Tests
 */
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryCostOperation } from "@exaix/core";
import { LlmLearningExtractor } from "@exaix/memory";
import { ProposalLearningSchema } from "@exaix/schemas/memory_bank.ts";
import { castAny, createMinimalExecutionMemory } from "@exaix/testing";

const POLICY_INSTRUCTIONS = "Only retain non-derivable, reusable and actionable knowledge.";

class StubProvider implements IModelProvider {
  id = "llm-extractor-test";
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

function skillsService(): ISkillsService {
  return castAny<ISkillsService>({
    getSkill: (skillId: string) =>
      Promise.resolve(
        skillId === "memory-extraction-content-policy"
          ? {
            skill_id: skillId,
            instructions: POLICY_INSTRUCTIONS,
          }
          : null,
      ),
  });
}

function costRouter(recorded: Array<{ cost: number; operation: MemoryCostOperation }>): IMemoryCostRouter {
  return castAny<IMemoryCostRouter>({
    recordOperation(cost: number, operation: MemoryCostOperation) {
      recorded.push({ cost, operation });
      return Promise.resolve();
    },
  });
}

Deno.test("LlmLearningExtractor: loads policy and returns schema-valid varied quality scores", async () => {
  const provider = new StubProvider(JSON.stringify({
    learnings: [{
      title: "Prefer explicit async boundaries",
      description: "Await extraction before proposal creation so asynchronous strategies cannot race.",
      category: LearningCategory.PATTERN,
      tags: ["async", "memory"],
      quality_score: 0.92,
    }, {
      title: "Review sparse execution summaries",
      description: "Sparse summaries provide weak evidence and should be reviewed before reuse.",
      category: LearningCategory.INSIGHT,
      tags: ["quality"],
      quality_score: 0.21,
    }],
  }));
  const recorded: Array<{ cost: number; operation: MemoryCostOperation }> = [];
  const extractor = new LlmLearningExtractor(provider, skillsService(), costRouter(recorded));

  const learnings = await extractor.extract(createMinimalExecutionMemory());

  assertEquals(learnings.map((learning) => learning.confidence), [
    ConfidenceAssessmentLevel.VERY_HIGH,
    ConfidenceAssessmentLevel.LOW,
  ]);
  assertEquals(learnings.map((learning) => learning.quality_score), [0.92, 0.21]);
  learnings.forEach((learning) => ProposalLearningSchema.parse(learning));
  assertStringIncludes(provider.prompt, POLICY_INSTRUCTIONS);
  assertEquals(recorded, [{ cost: 0.004, operation: MemoryCostOperation.EXTRACTION }]);
});

Deno.test("LlmLearningExtractor: repairs fenced JSON with a trailing comma", async () => {
  const provider = new StubProvider(`\`\`\`json
{"learnings":[{"title":"Reusable validation","description":"Validate structured model output before storing it.","category":"pattern","tags":["validation"],"quality_score":0.7,},],}
\`\`\``);
  const extractor = new LlmLearningExtractor(provider, skillsService(), costRouter([]));

  const learnings = await extractor.extract(createMinimalExecutionMemory());

  assertEquals(learnings.length, 1);
  ProposalLearningSchema.parse(learnings[0]);
});

Deno.test("LlmLearningExtractor: rejects output that cannot satisfy the proposal schema", async () => {
  const provider = new StubProvider('{"learnings":[{"title":"Bad","quality_score":4}]}');
  const extractor = new LlmLearningExtractor(provider, skillsService(), costRouter([]));

  await assertRejects(() => extractor.extract(createMinimalExecutionMemory()));
});

Deno.test("ProposalLearningSchema: quality_score is additive and bounded to zero through one", () => {
  const base = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: "execution",
    scope: "project",
    title: "Bounded quality",
    description: "Quality is expressed as a normalized score.",
    category: "insight",
    confidence: "medium",
  };

  ProposalLearningSchema.parse(base);
  ProposalLearningSchema.parse({ ...base, quality_score: 1 });
  assertThrows(() => ProposalLearningSchema.parse({ ...base, quality_score: 1.01 }));
});
