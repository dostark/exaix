/**
 * @module LoopClosesTest
 * @path packages/memory/tests/reflection/loop_closes_test.ts
 * @description Verifies the self-learning loop closes end-to-end: an execution's lessons_learned extracted by the real policy-guided LLM extractor with a high model-assessed quality score lands in Memory/Pending and auto-approves into the global bank under enabled auto-approve (bar unchanged: HIGH threshold, quiet-period respected), while a low-quality learning stays pending.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import { ConfidenceAssessmentLevel, ExecutionStatus } from "@exaix/core";
import {
  LlmLearningExtractor,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryExtractorService,
} from "@exaix/memory";
import type { IMemoryBankService, IMemoryCostRouter, ISkillsService } from "@exaix/core/types";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";

const POLICY_INSTRUCTIONS = "Retain non-derivable knowledge; prune structural restatements.";

class StubProvider implements IModelProvider {
  id = "loop-closes-test";
  constructor(private content: string) {}
  generate() {
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0.002,
    });
  }
}

function skillsService(): Pick<ISkillsService, "getSkill"> {
  return castAny<Pick<ISkillsService, "getSkill">>({
    getSkill: (skillId: string) =>
      Promise.resolve(
        skillId === "memory-extraction-content-policy"
          ? { skill_id: skillId, instructions: POLICY_INSTRUCTIONS }
          : null,
      ),
  });
}

function execution(lessons: string[]): IExecutionMemory {
  return {
    ...createMinimalExecutionMemory({ trace_id: crypto.randomUUID() }),
    lessons_learned: lessons,
    status: ExecutionStatus.COMPLETED,
  };
}

Deno.test("high-quality extracted learning auto-approves; low-quality stays pending (bar unchanged)", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    config.memory.auto_approve = {
      ...config.memory.auto_approve,
      enabled: true,
      confidence_threshold: ConfidenceAssessmentLevel.HIGH,
      delay_hours: 1,
      sources_allowed: ["AGENT"],
      max_batch_size: 20,
    };
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const extractor = new MemoryExtractorService(
      config,
      db,
      castAny<IMemoryBankService>(bank),
      undefined,
      {
        costRouter: castAny<IMemoryCostRouter>({
          isRemoteAllowed: () => Promise.resolve(true),
          recordOperation: () => Promise.resolve(),
        }),
        llmStrategy: new LlmLearningExtractor(
          new StubProvider(JSON.stringify({
            learnings: [
              {
                title: "Wrap flaky integration calls in exponential backoff",
                description:
                  "Integration calls fail transiently; exponential backoff with jitter recovers them reliably.",
                category: "insight",
                tags: ["reliability"],
                quality_score: 0.95,
              },
              {
                title: "Module imports fact",
                description: "File billing/a.ts imports billing/b.ts.",
                category: "insight",
                tags: [],
                quality_score: 0.5,
              },
            ],
          })),
          castAny<ISkillsService>(skillsService()),
          castAny<IMemoryCostRouter>({
            isRemoteAllowed: () => Promise.resolve(true),
            recordOperation: () => Promise.resolve(),
          }),
        ),
      },
    );

    const extracted = (await extractor.analyzeExecution(execution([
      "Wrap flaky integration calls in exponential backoff",
      "Module imports fact",
    ]))) as IProposalLearning[];
    assertEquals(extracted.length, 2);
    assertEquals(
      extracted[0].confidence,
      ConfidenceAssessmentLevel.VERY_HIGH,
      "quality 0.95 must map to real high confidence",
    );

    // Mirror the execution loop's proposal write, backdated past the quiet period.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const run = execution(["proposal-write"]);
    for (const learning of extracted) {
      await extractor.createProposal({ ...learning, extracted_at: twoHoursAgo }, run, "test-role");
    }
    assertEquals((await extractor.listPending()).length, 2);

    const autoApproval = new MemoryAutoApprovalService(config, extractor);
    const result = await autoApproval.runApprovalCycle();
    assertEquals(result.promoted.length, 1, "only the high-quality learning may auto-approve");
    assertEquals((await extractor.listPending()).length, 1, "the low-quality learning stays pending");

    // Approval routes project-scoped proposals through the bank's project pipeline.
    const projectMemory = await bank.getProjectMemory(run.portal);
    const approvedPattern = projectMemory?.patterns.find((p) =>
      p.name === "Wrap flaky integration calls in exponential backoff"
    );
    assertEquals(approvedPattern !== undefined, true, "the high-quality learning must be approved into the bank");
  } finally {
    await cleanup();
  }
});
