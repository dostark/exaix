#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunMemoryFullLoop
 * @path tests/scenario_framework/scripts/run_memory_full_loop.ts
 * @description Phase 147 Step 12 scenario driver: the full memory-maturation chain —
 *   capture (real ReAct loop calling remember_fact through a real context-wired
 *   ToolRegistry) → extract (scratchpad-informed, content-curation-guided) → approve
 *   (real MemoryAutoApprovalService cycle, auto_approve.enabled=true) → retrieve
 *   (SessionMemoryService hybrid/temporal) → reflect (real MemoryReflectionCycle with
 *   synthesis + topical links) — asserted end-to-end in one run against the mocked
 *   provider, with every stage's on-disk state verified.
 * @architectural-layer Test
 * @dependencies [packages/execution, packages/tool-runtime, packages/memory, packages/ai]
 * @related-files [tests/scenario_framework/scenarios/agent_flows/memory-full-loop.yaml]
 */

import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai";
import { join } from "@std/path";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX, SecurityMode, ToolName } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { MemoryStatus } from "@exaix/core/status";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import { ExecutionContextService, OutputParser, ReActLoopAdapter, ReActLoopStrategy } from "@exaix/execution";
import {
  HeuristicExtractionStrategy,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryEmbeddingService,
  MemoryExtractorService,
  MemoryReflectionService,
  SessionMemoryService,
} from "@exaix/memory";
import { ToolRegistry } from "@exaix/tool-runtime";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import {
  castAny,
  createMinimalExecutionMemory,
  createSampleLearning,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  initTestDbService,
} from "@exaix/testing";
import type {
  IApplicationContext,
  IMemoryCostRouter,
  IMemoryEmbeddingService,
  ISkillsService,
} from "@exaix/core/types";

const POLICY_SKILL_ID = "memory-extraction-content-policy";
const CAPTURED_CONTENT = "Rate limiter resets on full restart, not per request";
const MAX_TOOL_CALLS = 3;
const EXECUTION_TIMEOUT_MS = 120_000;

/** First turn must call remember_fact; second turn may complete only after the write lands. */
class RememberFactProvider implements IModelProvider {
  readonly id = "phase-147-memory-loop";
  private callCount = 0;

  generate(prompt: string): Promise<IGenerateResult> {
    const availableTools = prompt.match(/AVAILABLE TOOLS:\n([^\n]+)/)?.[1]?.split(", ") ?? [];
    let content: string;
    if (this.callCount === 0) {
      if (!availableTools.includes(ToolName.REMEMBER_FACT)) {
        throw new Error("the ReAct turn did not expose remember_fact to the agent");
      }
      content = `${REACT_THOUGHT_PREFIX}Capture the rate-limiter gotcha before it is lost.
\`\`\`toml
[[actions]]
tool = "${ToolName.REMEMBER_FACT}"
[actions.params]
content = "${CAPTURED_CONTENT}"
\`\`\``;
    } else {
      if (!prompt.includes("entry_id")) {
        throw new Error("remember_fact result did not reach the agent's next turn");
      }
      content = `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Captured the rate-limiter gotcha; run complete.`;
    }
    this.callCount++;
    return Promise.resolve({
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "phase-147-scripted",
      provider: this.id,
      cost_usd: 0,
    });
  }
}

function usageError(): never {
  console.error("Usage: run_memory_full_loop.ts <workspace-root>");
  Deno.exit(1);
}

if (import.meta.main) {
  const workspaceRoot = Deno.args[0];
  if (!workspaceRoot) usageError();

  const config: Config = ConfigSchema.parse({
    system: { root: workspaceRoot },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
    memory: { auto_approve: { enabled: true, delay_hours: 1, confidence_threshold: "medium" } },
  });

  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const provider = new RememberFactProvider();
    const executionMemoryStore = new ExecutionMemoryStore(config, logger);
    const context = {
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
      config: createStubConfig(config),
      executionMemoryStore,
    } as IApplicationContext;

    // (1) CAPTURE: real ReAct loop calls remember_fact through the real registry.
    const traceId = crypto.randomUUID();
    const registry = new ToolRegistry({ config, traceId, baseDir: workspaceRoot, context });
    const adapter = new ReActLoopAdapter(
      new OutputParser(),
      new ExecutionContextService(config, logger, {}),
      logger,
      registry,
    );
    const strategy = new ReActLoopStrategy(adapter, provider);
    const result = await strategy.execute(
      { name: "memory-loop-agent", capabilities: ["memory-capture"], model: "phase-147-scripted" } as never,
      {
        trace_id: traceId,
        request_id: `phase-147-${traceId}`,
        request: "Capture anything worth remembering during this run via remember_fact.",
        plan: "Notice and record in-the-moment insights with the scratchpad tool.",
        portal: "none",
      },
      {
        identity_id: "phase-147-memory-loop",
        portal: "none",
        permitted_tools: [ToolName.REMEMBER_FACT],
        security_mode: SecurityMode.SANDBOXED,
        timeout_ms: EXECUTION_TIMEOUT_MS,
        max_tool_calls: MAX_TOOL_CALLS,
        audit_enabled: true,
      },
    );
    const notes = await executionMemoryStore.readNotes(traceId);
    if (notes.length !== 1 || notes[0].content !== CAPTURED_CONTENT) {
      throw new Error(`capture failed: ${JSON.stringify(notes)}`);
    }

    // (2) EXECUTION RECORD with lessons_learned.
    const memoryBank = new MemoryBankService(config, logger);
    await memoryBank.createExecutionRecord(createMinimalExecutionMemory({
      trace_id: traceId,
      summary: "Agent captured an in-the-moment gotcha via remember_fact.",
      lessons_learned: ["Rate limiter resets on full restart, not per request"],
    }));

    // (3) EXTRACTION: scratchpad-informed heuristic fallback (deterministic, no LLM), then
    // proposals through the normal createProposal path.
    const embeddingService = new MemoryEmbeddingService(config);
    await embeddingService.initializeManifest();
    memoryBank.setEmbeddingService(embeddingService);
    const costRouter = castAny<IMemoryCostRouter>({
      isRemoteAllowed: () => Promise.resolve(false),
      recordOperation: () => Promise.resolve(),
    });
    const memoryExtractor = new MemoryExtractorService(config, db, memoryBank, logger, {
      costRouter,
      heuristicStrategy: new HeuristicExtractionStrategy(executionMemoryStore),
    });
    const executionMemory = (await memoryBank.getExecutionByTraceId(traceId))!;
    const candidates = await memoryExtractor.analyzeExecution(executionMemory);
    for (const candidate of candidates) {
      candidate.scope = MemoryScope.GLOBAL;
      candidate.project = undefined;
      await memoryExtractor.createProposal(candidate, executionMemory, "scenario-identity");
    }
    const pending = await memoryExtractor.listPending();
    if (pending.length < 1) throw new Error("extraction produced no Pending proposals");

    // (4) APPROVAL: the real auto-approval cycle with auto_approve.enabled=true (the
    // on-disk extracted_at backdate stands in for delay_hours, whose schema minimum is 1h).
    for (const proposal of pending) {
      proposal.learning.extracted_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await Deno.writeTextFile(
        join(config.system.root, config.paths.memory, "Pending", `${proposal.id}.json`),
        JSON.stringify(proposal, null, 2),
      );
    }
    const autoApprovalService = new MemoryAutoApprovalService(config, memoryExtractor);
    const approvalResult = await autoApprovalService.runApprovalCycle();
    if (approvalResult.promoted.length < 1) throw new Error("auto-approval promoted nothing");
    const global = await memoryBank.getGlobalMemory();
    const approved = global?.learnings.filter((l) => l.status === MemoryStatus.APPROVED) ?? [];

    // (5) RETRIEVAL for a later request.
    const sessionMemory = new SessionMemoryService(memoryBank, embeddingService);
    await memoryBank.rebuildIndicesWithEmbeddings(embeddingService);
    const enhanced = await sessionMemory.enhanceRequest("rate limiter restarts");
    const retrieved = enhanced.memories.length > 0;

    // REFLECTION: seed a related learning, then the real cycle synthesises and writes
    // topical links (the similarity oracle mirrors the reflection suite's own stubs).
    const relatedLearning: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff state resets on full restart",
      description: "Backoff and limiter state must be process-lifetime aware, not per request.",
      category: LearningCategory.INSIGHT,
      status: MemoryStatus.APPROVED,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.addGlobalLearning(relatedLearning);
    const reflectionEmbedding = castAny<IMemoryEmbeddingService>({
      searchByEmbedding: (_query: string) => {
        const ids = [approved[0]?.id, relatedLearning.id].filter((id): id is string => Boolean(id));
        return Promise.resolve(
          ids.map((id) => ({ id, title: "", summary: "", similarity: 0.95, kind: "learning" })),
        );
      },
      embed: () => Promise.resolve(),
      embedLearning: () => Promise.resolve(),
      initializeManifest: () => Promise.resolve(),
    });
    const skillsService = castAny<ISkillsService>({
      getSkill: (skillId: string) =>
        Promise.resolve(
          skillId === POLICY_SKILL_ID
            ? { skill_id: skillId, instructions: "Deprioritize structural-only facts." }
            : null,
        ),
    });
    const reflection = new MemoryReflectionService({
      provider,
      skillsService,
      memoryBank,
      embeddingService: reflectionEmbedding,
      proposalWriter: memoryExtractor,
      logger,
      costRouter: castAny<IMemoryCostRouter>({
        isRemoteAllowed: () => Promise.resolve(true),
        recordOperation: () => Promise.resolve(),
      }),
    });
    // The reflection provider call reuses the scripted sequence (now cycled back to its
    // first slot, the remember_fact TOML) — so point the cycle at a dedicated scripted
    // provider whose single response is the synthesis action for the approved pair.
    const reflectionProvider: IModelProvider = {
      id: "phase-147-reflection",
      generate: () => {
        if (approved.length < 1) return Promise.reject(new Error("no approved learning to synthesise from"));
        return Promise.resolve({
          content: JSON.stringify({
            actions: [{
              action: "synthesise",
              source_ids: [approved[0].id, relatedLearning.id],
              title: "Process-lifetime state needs explicit reset handling",
              description:
                "Synthesised from the captured gotcha and its related learning: restart-resilient state must be handled at process scope.",
              category: LearningCategory.INSIGHT,
              tags: ["reliability"],
              quality_score: 0.85,
            }],
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "phase-147-scripted",
          provider: "phase-147-reflection",
          cost_usd: 0,
        });
      },
    };
    const boundReflection = new MemoryReflectionService({
      provider: reflectionProvider,
      skillsService,
      memoryBank,
      embeddingService: reflectionEmbedding,
      proposalWriter: memoryExtractor,
      logger,
      costRouter: castAny<IMemoryCostRouter>({
        isRemoteAllowed: () => Promise.resolve(true),
        recordOperation: () => Promise.resolve(),
      }),
    });
    const reflectionResult = await boundReflection.runReflectionCycle();
    void reflection;
    const globalAfterReflection = (await memoryBank.getGlobalMemory())!;
    const linked = globalAfterReflection.learnings.find((l) => l.id === relatedLearning.id);
    const topicalLinked = linked?.links?.some((link) => link.target_id === approved[0].id && link.type === "topical") ??
      false;

    await db.waitForFlush();
    const summary = {
      scratchpad_entries: notes.length,
      tool_calls: result.tool_calls ?? 0,
      pending_before_approval: pending.length,
      approved_count: approvalResult.promoted.length,
      retrieved,
      synthesised: reflectionResult.synthesised_count,
      topical_linked: topicalLinked,
    };
    if (
      summary.scratchpad_entries !== 1 || summary.tool_calls !== 1 ||
      summary.approved_count < 1 || !summary.retrieved ||
      summary.synthesised !== 1 || !summary.topical_linked
    ) {
      throw new Error(`cutover invariant violated: ${JSON.stringify(summary)}`);
    }
    console.log(JSON.stringify(summary));
  } finally {
    await cleanup();
  }
}
