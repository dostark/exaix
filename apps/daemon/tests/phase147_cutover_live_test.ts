/**
 * @module Phase147CutoverLiveTest
 * @path apps/daemon/tests/phase147_cutover_live_test.ts
 * @description [live, operator-run] Phase 147 Step 12: the same memory-maturation chain as
 *   phase147_cutover_test.ts, against a real Ollama provider instead of MockProviderFactory.
 *   Not CI-run: live-provider convention (EXA_TEST_LLM_PROVIDER / EXA_TEST_LLM_MODEL).
 *   Unlike the mock cutover, assertions are intentionally loose — a real model decides what
 *   to extract and how confident it is, so the test proves the WIRING carries real model
 *   behavior end-to-end (capture → extract → pending → approval attempt → retrieval), not
 *   any specific extraction outcome.
 * @architectural-layer Services (test)
 * @related-files [apps/daemon/tests/phase147_cutover_test.ts, packages/execution/tests/agents/react_loop_strategy_live_test.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";

import { ExecutionContextService, OutputParser, ReActLoopAdapter, ReActLoopStrategy } from "@exaix/execution";
import { ToolRegistry } from "@exaix/tool-runtime";
import { SecurityMode, ToolName } from "@exaix/core";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { OllamaProvider } from "@exaix/ai-ollama";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { OpenAIProvider } from "@exaix/ai-openai";
import { GoogleProvider } from "@exaix/ai-google";
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
import {
  castAny,
  createMinimalExecutionMemory,
  ENV_ANTHROPIC_API_KEY,
  ENV_GOOGLE_API_KEY,
  ENV_OPENAI_API_KEY,
  getTestLlmModel,
  getTestLlmProvider,
  initTestDbService,
} from "@exaix/testing";
import { ProviderType } from "@exaix/core";
import type { IApplicationContext, IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_SKILL_ID = "memory-extraction-content-policy";

const testProvider = getTestLlmProvider();
const testModel = getTestLlmModel();

/** The env var name carrying the real API key for a given provider's own factory/tests. */
const API_KEY_ENV_BY_PROVIDER: Partial<Record<ProviderType, string>> = {
  [ProviderType.ANTHROPIC]: ENV_ANTHROPIC_API_KEY,
  [ProviderType.OPENAI]: ENV_OPENAI_API_KEY,
  [ProviderType.GOOGLE]: ENV_GOOGLE_API_KEY,
};

function buildTestProvider(provider: string, model: string): IModelProvider {
  if (provider === ProviderType.OLLAMA) return new OllamaProvider({ model, timeoutMs: 300_000 });
  const apiKey = provider === ProviderType.OPENAI
    ? Deno.env.get(ENV_OPENAI_API_KEY)
    : provider === ProviderType.GOOGLE
    ? Deno.env.get(ENV_GOOGLE_API_KEY)
    : Deno.env.get(ENV_ANTHROPIC_API_KEY);
  switch (provider as ProviderType) {
    case ProviderType.OPENAI:
      return new OpenAIProvider({ apiKey: apiKey ?? "", model });
    case ProviderType.GOOGLE:
      return new GoogleProvider({ apiKey: apiKey ?? "", model });
    case ProviderType.ANTHROPIC:
    default:
      return new AnthropicProvider({ apiKey: apiKey ?? "", model });
  }
}

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

const testApiKeyEnvVar = API_KEY_ENV_BY_PROVIDER[testProvider as ProviderType];

Deno.test({
  name: `[live][phase-147 cutover] the full memory chain runs against a real provider (${testProvider}:${testModel})`,
  // Live-provider convention: keyed providers require their API key; the local ollama
  // provider requires EXA_TEST_LLM_PROVIDER=ollama explicitly.
  ignore: !(testProvider === ProviderType.OLLAMA || Boolean(testApiKeyEnvVar && Deno.env.get(testApiKeyEnvVar))),
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
      const provider = buildTestProvider(testProvider, testModel);

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

      // (1) CAPTURE: a real ReAct loop with the real model calls remember_fact through a
      // real context-wired ToolRegistry — the live scratchpad-capture criterion, closed.
      const traceId = crypto.randomUUID();
      const context: IApplicationContext = {
        db,
        provider,
        git: createStubGit(),
        display: createStubDisplay(db),
        config: createStubConfig(config),
        executionMemoryStore,
      };
      const registry = new ToolRegistry({ config, traceId, baseDir: tempDir, context });
      const adapter = new ReActLoopAdapter(
        new OutputParser(),
        new ExecutionContextService(config, logger, {}),
        logger,
        registry,
      );
      const reactStrategy = new ReActLoopStrategy(adapter, provider);
      const reactResult = await reactStrategy.execute(
        { name: "live-cutover-agent", capabilities: ["memory-capture"], model: testModel } as never,
        {
          trace_id: traceId,
          request_id: `live-cutover-${traceId}`,
          request:
            'First, call the remember_fact tool to capture this fact: "Rate limiter resets on full restart, not per request". Then finish.',
          plan: "Capture the in-the-moment insight with remember_fact, then complete.",
          portal: "none",
        },
        {
          identity_id: "live-cutover-agent",
          portal: "none",
          permitted_tools: [ToolName.REMEMBER_FACT],
          security_mode: SecurityMode.SANDBOXED,
          timeout_ms: 300_000,
          max_tool_calls: 4,
          audit_enabled: true,
        },
      );
      const notes = await executionMemoryStore.readNotes(traceId);
      assertEquals(
        notes.length >= 1,
        true,
        `a real agent run must call remember_fact and land at least one entry in scratchpad.jsonl (got ${notes.length}; tool_calls=${
          reactResult.tool_calls ?? 0
        })`,
      );
      console.log(
        `live capture: notes=${notes.length} tool_calls=${reactResult.tool_calls ?? 0}`,
      );

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
      const remaining = await memoryExtractor.listPending();
      // A proposal is honestly pending when the real model scored it below the approval
      // threshold (default HIGH = 4 on the very_low..very_high scale).
      const confidenceScores: Record<string, number> = {
        very_low: 1,
        low: 2,
        medium: 3,
        high: 4,
        very_high: 5,
      };
      const allRemainingBelowThreshold = remaining.every(
        (p) => (confidenceScores[p.learning.confidence] ?? 0) < 4,
      );
      console.log(
        `live cutover: promoted=${promoted.length} remaining=${remaining.length} ` +
          `confidences=${JSON.stringify(remaining.map((p) => p.learning.confidence))}`,
      );
      assertEquals(
        promoted.length > 0 || allRemainingBelowThreshold,
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
