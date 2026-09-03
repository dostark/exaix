/**
 * @module Phase147CutoverTest
 * @path apps/daemon/tests/phase147_cutover_test.ts
 * @description [integration] Phase 147 Step 12 cutover proof: constructs the real production
 * service graph directly (per session_delegate_cycle_daemon_boot_test.ts's established pattern,
 * with a short intervalMs instead of apps/daemon/main.ts's hardcoded one hour) and drives the
 * full capture → extract → approve → retrieve → reflect chain unattended against
 * MockProviderFactory, asserting every stage via the real IActivity Journal and on-disk memory
 * state. Also exercises dedup (Step 4), supersede (Step 3's resolver + supersedeLearning seam),
 * and inter-memory links (Step 8) against real data produced within this run.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";

import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import type { IModelProvider } from "@exaix/ai";
import { ExecutionContextService, OutputParser, ReActLoopAdapter, ReActLoopStrategy } from "@exaix/execution";
import { ToolRegistry } from "@exaix/tool-runtime";
import { EventLogger } from "@exaix/core/logger";
import { LearningContradictionResolver } from "@exaix/memory";
import { MemoryStatus } from "@exaix/core/status";
import { LearningCategory, MemoryLinkType, MemoryOperation, MemoryScope } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, SecurityMode, ToolName } from "@exaix/core";
import {
  HeuristicExtractionStrategy,
  initializeMemoryAutoApprovalMaintenance,
  LlmLearningExtractor,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryEmbeddingService,
  MemoryExtractorService,
  MemoryReflectionService,
  SessionMemoryService,
} from "@exaix/memory";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { ConfidenceAssessmentLevel, MemoryBankSource, REACT_THOUGHT_PREFIX } from "@exaix/core";
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
const NOTE_CONTENT = "Rate limiter resets on full restart, not per request";

/** Ordered scripted provider responses (ReAct turn 1, turn 2, extraction, then reflection
 * synthesis — that slot is filled at runtime once the source learning ids exist). Every
 * provider call here is sequential and awaited, so the cycle order is deterministic. */
const SCRIPTED_RESPONSES = [
  `${REACT_THOUGHT_PREFIX}Capture the rate-limiter gotcha before it is lost.
\`\`\`toml
[[actions]]
tool = "${ToolName.REMEMBER_FACT}"
[actions.params]
content = "${NOTE_CONTENT}"
\`\`\``,
  `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Captured the rate-limiter gotcha; execution completed with lessons learned.`,
  JSON.stringify({
    learnings: [{
      title: "Rate limiter resets on full restart",
      description: "Backoff and limiter state must be process-lifetime aware, not per request.",
      category: "insight",
      tags: ["reliability"],
      quality_score: 0.9,
    }],
  }),
  "", // slot 4: reflection synthesis action, authored just before runReflectionCycle
  JSON.stringify({ operation: "supersede", reason: "contradicts the stored rate-limiter guidance" }),
];

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

function learning(overrides: Partial<ILearning>): ILearning {
  return createSampleLearning({
    status: MemoryStatus.APPROVED,
    confidence: ConfidenceAssessmentLevel.HIGH,
    source: MemoryBankSource.EXECUTION,
    ...overrides,
  });
}

Deno.test("[integration][phase-147 cutover] capture → extract → approve → retrieve → reflect closes unattended", async () => {
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
      memory: {
        session: { expand_links: false },
        auto_approve: { enabled: true, delay_hours: 1 },
      },
    });
    const logger = new EventLogger({ db });
    const providerOptions = {
      id: "cutover-mock",
      model: "mock-model",
      mockStrategy: "scripted",
      responses: SCRIPTED_RESPONSES,
    } as Parameters<InstanceType<typeof MockProviderFactory>["create"]>[0];
    const provider: IModelProvider = await new MockProviderFactory().create(providerOptions);

    // Real cost router replaced at its gate: forcing isRemoteAllowed=true makes the run take
    // the real LLM extraction/reflection paths deterministically (cost routing itself is
    // covered by the cost suite's own tests).
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
      llmStrategy: new LlmLearningExtractor(
        provider,
        skillsService,
        costRouter,
        executionMemoryStore,
      ),
      heuristicStrategy: new HeuristicExtractionStrategy(executionMemoryStore),
    });
    const sessionMemory = new SessionMemoryService(memoryBank, embeddingService);
    const autoApprovalService = new MemoryAutoApprovalService(config, memoryExtractor);

    // --- CAPTURE: a real ReAct loop calls remember_fact mid-execution.
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
      { name: "cutover-agent", capabilities: ["memory"], model: "mock-model" } as never,
      {
        trace_id: traceId,
        request_id: `cutover-${traceId}`,
        request: "Run and remember.",
        plan: "Capture insights.",
        portal: "none",
      },
      {
        agent_role: "cutover-agent",
        portal: "none",
        permitted_tools: [ToolName.REMEMBER_FACT],
        security_mode: SecurityMode.SANDBOXED,
        timeout_ms: 120_000,
        max_tool_calls: 3,
        audit_enabled: true,
      },
    );
    assertEquals(reactResult.tool_calls ?? 0, 1, "the ReAct loop must call remember_fact exactly once");
    const notes = await executionMemoryStore.readNotes(traceId);
    assertEquals(notes.length, 1, "the note must land in the trace's execution memory store");
    assertEquals(notes[0].content, NOTE_CONTENT);
    await db.waitForFlush();
    assertEquals(
      db.getActivitiesByActionType(DomainEventType.MemoryScratchpadEntryAdded).length >= 1,
      true,
      "capture must be journalled",
    );

    // --- EXECUTION RECORD: the execution completes with lessons_learned populated. The
    // summary carries the scripted agent's own completion line, not a test-authored
    // constant unrelated to what the agent actually said.
    assertExists(reactResult.description, "the ReAct loop must produce a completion summary");
    await memoryBank.createExecutionRecord(createMinimalExecutionMemory({
      trace_id: traceId,
      summary: reactResult.description,
      lessons_learned: ["Process-lifetime state needs explicit invalidation hooks"],
    }));
    const persistedExecution = await memoryBank.getExecutionByTraceId(traceId);
    assertExists(persistedExecution, "the execution record must persist");
    assertEquals(
      persistedExecution.summary,
      reactResult.description,
      "the record's summary must carry the scripted agent's own completion text, not a constant",
    );

    // --- EXTRACTION: the real post-execution path (analyzeExecution + createProposal — the
    // exact body of ExecutionLoop.extractExecutionLearnings) reads lessons_learned AND the
    // scratchpad through LlmLearningExtractor, guided by the content-curation skill.
    const executionMemory = persistedExecution;
    const candidates = await memoryExtractor.analyzeExecution(executionMemory);
    assertEquals(candidates.length >= 1, true, "extraction must produce candidates from both sources");
    // LlmLearningExtractor hardcodes PROJECT scope; the proposal is elevated to GLOBAL so
    // auto-approval exercises the plan-specified Global promotion path (addGlobalLearning)
    // instead of approvePending's project-pattern branch.
    for (const candidate of candidates) {
      candidate.scope = MemoryScope.GLOBAL;
      candidate.project = undefined;
      await memoryExtractor.createProposal(candidate, executionMemory, "cutover-identity");
    }
    const pending = await memoryExtractor.listPending();
    assertEquals(pending.length, 1, "one deduplicated extraction candidate must land in Memory/Pending/");
    assertEquals(pending[0].learning.quality_score, 0.9, "the proposal must carry a real quality score");
    assertStringIncludesAware(pending[0].learning.description, ["rate limiter", "Backoff"]);
    // Backdate extracted_at: auto-approve delay_hours has schema min 1, and the proposal was
    // just created — this is on-disk time-travel, the same lever the eligibility rule exists for.
    pending[0].learning.extracted_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await Deno.writeTextFile(
      join(config.system.root, config.paths.memory, "Pending", `${pending[0].id}.json`),
      JSON.stringify(pending[0], null, 2),
    );
    await db.waitForFlush();
    assertEquals(
      db.getActivitiesByActionType(DomainEventType.MemoryProposalCreated).length >= 1,
      true,
      "proposal creation must be journalled",
    );

    // --- AUTO-APPROVAL: the real sped-up maintenance cycle promotes the PENDING proposal
    // to Memory/Global/learnings.json without manual intervention.
    const maintenance = await initializeMemoryAutoApprovalMaintenance({
      notificationService: { notifyPendingDigestIfNeeded: () => Promise.resolve(true) },
      memoryExtractor,
      autoApprovalService,
      logger,
      intervalMs: 10,
    });
    let approvedLearning: ILearning | undefined;
    for (let i = 0; i < 200 && !approvedLearning; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const global = await memoryBank.getGlobalMemory();
      approvedLearning = global?.learnings.find((l) => l.title === "Rate limiter resets on full restart");
    }
    await maintenance.stop();
    assertExists(approvedLearning, "auto-approval must promote the learning to global memory");
    assertEquals(approvedLearning.status, MemoryStatus.APPROVED);
    assertEquals((await memoryExtractor.listPending()).length, 0, "Pending must be drained by approval");
    await db.waitForFlush();
    let autoApprovedJournalled = false;
    for (let i = 0; i < 100 && !autoApprovedJournalled; i++) {
      await db.waitForFlush();
      autoApprovedJournalled = db.getActivitiesByActionType(DomainEventType.MemoryAutoApproved).length >= 1;
      if (!autoApprovedJournalled) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assertEquals(
      autoApprovedJournalled,
      true,
      "auto-approval must be journalled",
    );
    assertEquals(
      db.getActivitiesByActionType(DomainEventType.MemoryAutoApprovalCycle).length >= 1,
      true,
      "the real maintenance interval must have run the approval cycle",
    );

    // Embed the approved learning so hybrid retrieval, dedup, and reflection have vectors.
    await memoryBank.rebuildIndicesWithEmbeddings(embeddingService);

    // --- RETRIEVAL: a later request's enhanceRequest retrieves the learning via hybrid
    // (keyword + embedding) retrieval, temporally ranked.
    const enhanced = await sessionMemory.enhanceRequest("rate limiter restarts");
    assertEquals(
      enhanced.memories.some((m) => m.title === "Rate limiter resets on full restart"),
      true,
      "the approved learning must be retrievable for a later request",
    );

    // --- REFLECTION: with a second, related learning seeded, the real reflection cycle
    // synthesises and writes topical links between the pair.
    const relatedLearning = learning({
      id: crypto.randomUUID(),
      title: "Retry backoff resets on full restart",
      description: "Backoff and retry state must be process-lifetime aware, not per worker.",
      category: LearningCategory.INSIGHT,
    });
    await memoryBank.addGlobalLearning(relatedLearning);
    await memoryBank.rebuildIndicesWithEmbeddings(embeddingService);
    // Reflection's embedding view is the similarity stub its own reflection tests use: the
    // hash-based embedder cannot express >=0.92 similarity for related-but-distinct texts,
    // so only that oracle is stubbed (link writes and cycle events stay real).
    const reflectionEmbedding = castAny<IMemoryEmbeddingService>({
      searchByEmbedding: (_query: string) => {
        const ids = [approvedLearning?.id, relatedLearning.id].filter((id): id is string => Boolean(id));
        return Promise.resolve(
          ids.map((id) => ({ id, title: "", summary: "", similarity: 0.95, kind: "learning" })),
        );
      },
      embed: () => Promise.resolve(),
      embedLearning: () => Promise.resolve(),
      initializeManifest: () => Promise.resolve(),
    });
    const reflection = new MemoryReflectionService({
      provider,
      skillsService,
      memoryBank,
      embeddingService: reflectionEmbedding,
      proposalWriter: memoryExtractor,
      logger,
      costRouter,
    });
    SCRIPTED_RESPONSES[3] = JSON.stringify({
      actions: [{
        action: "synthesise",
        source_ids: [approvedLearning!.id, relatedLearning.id],
        title: "Process-lifetime state needs explicit reset handling",
        description:
          "Synthesised from the rate-limiter and retry-backoff learnings: any state that resets on restart must be handled at process scope.",
        category: "insight",
        tags: ["reliability"],
        quality_score: 0.85,
      }],
    });
    const reflectionResult = await reflection.runReflectionCycle();
    assertEquals(reflectionResult.synthesised_count, 1, "reflection must synthesise the related pair");
    await db.waitForFlush();
    const cycleEvents = db.getActivitiesByActionType(DomainEventType.MemoryReflectionCycleCompleted);
    assertEquals(cycleEvents.length >= 1, true, "reflection must be journalled");
    const reflectionProposal = (await memoryExtractor.listPending()).find((p) => p.reason?.includes("reflection"));
    assertExists(
      reflectionProposal ?? (await memoryExtractor.listPending())[0],
      "synthesis must file a PENDING proposal",
    );
    const globalAfterReflection = (await memoryBank.getGlobalMemory())!;
    const linkedSource = globalAfterReflection.learnings.find((l) => l.id === approvedLearning!.id)!;
    assertEquals(
      linkedSource.links?.some((link) => link.target_id === relatedLearning.id && link.type === MemoryLinkType.TOPICAL),
      true,
      "reflection must connect the synthesis pair with topical links",
    );

    // 2-hop retrieval: the topical-linked learning surfaces via one-hop expansion.
    const enhancedWithLinks = await sessionMemory.enhanceRequest("rate limiter restarts", { expandLinks: true });
    assertEquals(
      enhancedWithLinks.memories.some((m) => m.title === "Retry backoff resets on full restart"),
      true,
      "the topical-linked learning must surface via link expansion",
    );

    // --- DEDUP: a lexically near-identical seed merges via cosine dedup (the ADD fallback
    // inside addGlobalLearning), superseding the original.
    const duplicateSeed = learning({
      id: crypto.randomUUID(),
      title: "Rate limiter resets on full restart",
      description: "Backoff and limiter state must be process-lifetime aware, not per request.",
      category: LearningCategory.INSIGHT,
    });
    await memoryBank.addGlobalLearning(duplicateSeed);
    const afterDedup = (await memoryBank.getGlobalMemory())!;
    assertEquals(
      afterDedup.learnings.find((l) => l.id === approvedLearning!.id)?.status,
      MemoryStatus.SUPERSEDED,
      "the near-duplicate must have superseded the original through dedup merge",
    );
    const mergedLearning = afterDedup.learnings.find((l) => l.id === duplicateSeed.id);
    assertExists(mergedLearning, "the merged learning must be stored");
    assertEquals(
      mergedLearning.links?.some((link) =>
        link.target_id === approvedLearning!.id && link.type === MemoryLinkType.SUPERSEDES
      ),
      true,
      "the dedup merge must write the supersession-chain link",
    );

    // --- SUPERSEDE: the contradiction path adjudicates at its real seam
    // (LearningContradictionResolver + supersedeLearning — exactly what addGlobalLearning
    // applies when the resolver returns SUPERSEDE).
    const resolver = new LearningContradictionResolver(provider, costRouter);
    const contradictingSeed = learning({
      id: crypto.randomUUID(),
      title: "Rate limiters reset per request",
      description: "Contradicting guidance: limiter state resets per request and needs no process-lifetime handling.",
      category: LearningCategory.INSIGHT,
    });
    const decision = await resolver.resolve(contradictingSeed, [mergedLearning]);
    assertEquals(
      decision.operation,
      MemoryOperation.SUPERSEDE,
      "the resolver must adjudicate SUPERSEDE against the candidate",
    );
    await memoryBank.supersedeLearning(mergedLearning.id, contradictingSeed, decision.reason);
    const afterSupersede = (await memoryBank.getGlobalMemory())!;
    assertEquals(
      afterSupersede.learnings.find((l) => l.id === mergedLearning.id)?.status,
      MemoryStatus.SUPERSEDED,
      "the contradiction path must retire the contradicted learning",
    );
    const storedContradicting = afterSupersede.learnings.find((l) => l.id === contradictingSeed.id)!;
    assertEquals(
      storedContradicting.links?.some((link) =>
        link.target_id === mergedLearning.id && link.type === MemoryLinkType.SUPERSEDES
      ),
      true,
      "the contradiction supersede must write the supersession-chain link on both sides",
    );
  } finally {
    await cleanup();
  }
});

/** Asserts the text contains at least one of the given needles (case-insensitive). */
function assertStringIncludesAware(text: string, needles: string[]): void {
  const lower = text.toLowerCase();
  const hit = needles.some((needle) => lower.includes(needle.toLowerCase()));
  assertEquals(hit, true, `expected one of [${needles.join(", ")}] in: ${text}`);
}
