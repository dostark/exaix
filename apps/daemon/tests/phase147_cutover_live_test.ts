/**
 * @module Phase147CutoverLiveTest
 * @path apps/daemon/tests/phase147_cutover_live_test.ts
 * @description [live, operator-run] Phase 147 Step 12: the same memory-maturation chain as
 *   phase147_cutover_test.ts, against a real Ollama provider instead of MockProviderFactory.
 *   Not CI-run: gated on EXA_PHASE147_LIVE=1 (operator opt-in), matching this phase's Steps
 *   1/2 [live, operator-run] convention. Model is selectable via EXA_TEST_LLM_MODEL.
 *   Unlike the mock cutover, assertions are intentionally loose — a real model decides what
 *   to extract and how confident it is, so the test proves the WIRING carries real model
 *   behavior end-to-end (capture → extract → pending → approval attempt → retrieval), not
 *   any specific extraction outcome.
 * @architectural-layer Services (test)
 * @related-files [apps/daemon/tests/phase147_cutover_test.ts, packages/execution/tests/agents/react_loop_strategy_live_test.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";

import { OllamaProvider } from "@exaix/ai-ollama";
import type { IModelProvider } from "@exaix/ai";
import { EventLogger } from "@exaix/core/logger";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryScope } from "@exaix/core";
import {
  HeuristicExtractionStrategy,
  initializeMemoryAutoApprovalMaintenance,
  LlmLearningExtractor,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryEmbeddingService,
  MemoryExtractorService,
  SessionMemoryService,
} from "@exaix/memory";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_SKILL_ID = "memory-extraction-content-policy";
const LIVE_GATE_ENV = "EXA_PHASE147_LIVE";

function loadPolicyInstructions(): string {
  const skillPath = join(
    import.meta.dirname ?? ".",
    "..",
    "..",
    "..",
    "Memory",
    "Skills",
    "global",
    "memory-extraction-content-policy.json",
  );
  const skill = JSON.parse(Deno.readTextFileSync(skillPath)) as { instructions?: string };
  assertExists(skill.instructions, "the shipped content-curation skill must carry instructions");
  return skill.instructions;
}

Deno.test({
  name: "[live][phase-147 cutover] the full memory chain runs against a real Ollama provider",
  // Operator-run only: requires a reachable Ollama instance and explicit opt-in.
  ignore: Deno.env.get(LIVE_GATE_ENV) !== "1",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    try {
      const config: Config = ConfigSchema.parse({
        system: { root: tempDir },
        paths: {},
        database: {},
        watcher: {},
        agents: {},
        models: {},
        portals: [],
        mcp: {},
        memory: { auto_approve: { enabled: true, delay_hours: 1 } },
      });
      const logger = new EventLogger({ db });
      const model = Deno.env.get("EXA_TEST_LLM_MODEL") ?? "llama3.1";
      const provider: IModelProvider = new OllamaProvider({ model, timeoutMs: 300_000 });

      // The real cost router decides remotely-gated operations from real budget state; the
      // extraction strategy gate below is forced open so the live path is exercised even on
      // a fresh budget.
      const costRouter = castAny<IMemoryCostRouter>({
        isRemoteAllowed: () => Promise.resolve(true),
        recordOperation: () => Promise.resolve(),
      });
      const realInstructions = loadPolicyInstructions();
      const skillsService = castAny<ISkillsService>({
        getSkill: (skillId: string) =>
          Promise.resolve(skillId === POLICY_SKILL_ID ? { skill_id: skillId, instructions: realInstructions } : null),
      });

      const embeddingService = new MemoryEmbeddingService(config);
      await embeddingService.initializeManifest();
      const executionMemoryStore = new ExecutionMemoryStore(config, logger);
      const memoryBank = new MemoryBankService(config, logger);
      memoryBank.setEmbeddingService(embeddingService);
      const memoryExtractor = new MemoryExtractorService(config, db, memoryBank, logger, {
        costRouter,
        llmStrategy: new LlmLearningExtractor(provider, skillsService, costRouter, executionMemoryStore),
        heuristicStrategy: new HeuristicExtractionStrategy(executionMemoryStore),
      });
      const sessionMemory = new SessionMemoryService(memoryBank, embeddingService);

      // (1) CAPTURE: the same tool + store path the ReAct loop uses.
      const traceId = crypto.randomUUID();
      const appendResult = await executionMemoryStore.appendNote(
        traceId,
        "Rate limiter resets on full restart, not per request",
        ["reliability"],
      );
      assertEquals(appendResult.success, true);

      // (2) EXECUTION RECORD.
      await memoryBank.createExecutionRecord(createMinimalExecutionMemory({
        trace_id: traceId,
        summary: "Live execution captured a rate-limiter insight and finished cleanly.",
        lessons_learned: ["Process-lifetime state needs explicit invalidation hooks"],
      }));

      // (3) EXTRACTION against the real model, guided by the content-curation skill.
      const executionMemory = (await memoryBank.getExecutionByTraceId(traceId))!;
      const candidates = await memoryExtractor.analyzeExecution(executionMemory);
      assertEquals(
        candidates.length >= 1,
        true,
        `the real model must extract at least one learning from lessons + scratchpad (got ${candidates.length})`,
      );
      for (const candidate of candidates) {
        candidate.scope = MemoryScope.GLOBAL;
        candidate.project = undefined;
        await memoryExtractor.createProposal(candidate, executionMemory, "live-operator");
      }
      const pending = await memoryExtractor.listPending();
      assertEquals(pending.length >= 1, true, "at least one proposal must land in Memory/Pending/");

      // (4) AUTO-APPROVAL: promote whatever clears the real confidence threshold.
      for (const proposal of pending) {
        proposal.learning.extracted_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        await Deno.writeTextFile(
          join(config.system.root, config.paths.memory, "Pending", `${proposal.id}.json`),
          JSON.stringify(proposal, null, 2),
        );
      }
      await memoryBank.rebuildIndicesWithEmbeddings(embeddingService);
      const autoApprovalService = new MemoryAutoApprovalService(config, memoryExtractor);
      const maintenance = await initializeMemoryAutoApprovalMaintenance({
        notificationService: { notifyPendingDigestIfNeeded: () => Promise.resolve(true) },
        memoryExtractor,
        autoApprovalService,
        logger,
        intervalMs: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await maintenance.stop();
      await db.waitForFlush();

      const global = await memoryBank.getGlobalMemory();
      const promoted = global?.learnings.filter((l) => l.status === MemoryStatus.APPROVED) ?? [];
      const drained = (await memoryExtractor.listPending()).length === 0;
      assertEquals(
        promoted.length > 0 || drained,
        true,
        "each proposal must either be auto-approved into global memory or remain honestly pending below the threshold",
      );

      // (5) RETRIEVAL: a later request can see what survived, via hybrid/temporal ranking.
      const enhanced = await sessionMemory.enhanceRequest("rate limiter restarts");
      if (promoted.length > 0) {
        const titles = new Set(enhanced.memories.map((m) => m.title));
        assertEquals(
          promoted.some((l: ILearning) => titles.has(l.title)),
          true,
          "a promoted learning must be retrievable for a later request",
        );
      }
    } finally {
      await cleanup();
    }
  },
});
