/**
 * @module ExecutionLoopMemoryExtractionTest
 * @path packages/execution/tests/execution_loop_memory_extraction_test.ts
 * @description Tests that ExecutionLoop wires MemoryExtractorService to auto-extract
 * learnings after successful execution and create pending proposals.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IApplicationContext, IMemoryExtractorService } from "@exaix/core/types";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import { ExecutionLoop } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import type { Insight, SaveInsightResult, SessionMemoryService } from "@exaix/memory";
import { EventLogger } from "@exaix/core/logger";
import { castAny, createMockConfig, initTestDbService } from "@exaix/testing";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";

Deno.test(
  "ExecutionLoop: calls analyzeExecution + createProposal after successful execution when context.extractor is set",
  async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "exec-extract-" });
    const { db, cleanup } = await initTestDbService();

    try {
      const config = createMockConfig(tempDir);
      const activeDir = join(config.system.root, config.paths.workspace, config.paths.active);
      const archiveDir = join(config.system.root, config.paths.workspace, config.paths.archive);
      const requestsDir = join(config.system.root, config.paths.workspace, config.paths.requests);
      await ensureDir(activeDir);
      await ensureDir(archiveDir);
      await ensureDir(requestsDir);

      // Create request file (needed for archiving)
      const requestId = "test-request-extract";
      await Deno.writeTextFile(
        join(requestsDir, `${requestId}.md`),
        `---
status: active
---`,
      );

      const traceId = crypto.randomUUID();
      const analyzedExecutions: IExecutionMemory[] = [];
      const createdProposals: Array<{ learning: IProposalLearning; identityId: string }> = [];

      // Spy extractor that records calls
      const spyExtractor: IMemoryExtractorService = {
        async analyzeExecution(execution: IExecutionMemory): Promise<IProposalLearning[]> {
          await Promise.resolve();
          analyzedExecutions.push(execution);
          return [{
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            source: MemoryBankSource.AGENT,
            scope: MemoryScope.GLOBAL,
            title: "Test learning from execution",
            description: "Auto-extracted learning for test",
            category: LearningCategory.INSIGHT,
            tags: ["test"],
            confidence: ConfidenceAssessmentLevel.MEDIUM,
          }];
        },
        createProposal(
          learning: IProposalLearning,
          _execution: IExecutionMemory,
          identityId: string,
        ): Promise<string> {
          createdProposals.push({ learning, identityId });
          return Promise.resolve(crypto.randomUUID());
        },
        listPending: () => Promise.resolve([]),
        getPending: () => Promise.resolve(null),
        approvePending: () => Promise.resolve(),
        rejectPending: () => Promise.resolve(),
        approveAll: () => Promise.resolve(0),
      };

      const context = castAny<IApplicationContext>({
        config: { get: () => config, getChecksum: () => "test" },
        db,
        provider: undefined,
        git: undefined,
        display: undefined,
        notificationService: undefined,
        extractor: spyExtractor,
      });

      const logger = new EventLogger({ db });
      const loop = new ExecutionLoop({
        config,
        db,
        identityId: "test-identity",
        context,
        memoryBank: new MemoryBankService(config, logger),
        gitServiceFactory: {
          createGitService(repoPath: string, traceId: string) {
            return new GitService({ config, traceId, identityId: "test-identity", repoPath });
          },
        },
        toolRegistryFactory: {
          createToolRegistry(traceId: string, baseDir: string) {
            return new ToolRegistry({ config, traceId, identityId: "test-identity", baseDir });
          },
        },
      });

      // Write plan that will succeed (no executable actions)
      const planContent = `---
trace_id: "${traceId}"
request_id: ${requestId}
status: active
agent_role: test-identity
---

# Test Plan
No actions — will succeed immediately
`;
      const planPath = join(activeDir, `${requestId}.md`);
      await Deno.writeTextFile(planPath, planContent);

      const result = await loop.processTask(planPath);

      assertEquals(result.success, true, `Execution should succeed: ${result.error}`);

      // Verify extraction was triggered
      assertEquals(
        analyzedExecutions.length >= 1,
        true,
        "analyzeExecution should be called at least once",
      );
      if (analyzedExecutions.length > 0) {
        assertEquals(analyzedExecutions[0].trace_id, traceId);
      }

      // Verify proposals were created
      assertEquals(
        createdProposals.length >= 1,
        true,
        "createProposal should be called at least once",
      );
      assertEquals(createdProposals[0].identityId, "test-identity");
    } finally {
      await cleanup();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "ExecutionLoop: does NOT call sessionMemory.saveInsight() during extraction - tiered feed is approval-gated",
  async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "exec-insight-" });
    const { db, cleanup } = await initTestDbService();

    try {
      const config = createMockConfig(tempDir);
      const activeDir = join(config.system.root, config.paths.workspace, config.paths.active);
      const archiveDir = join(config.system.root, config.paths.workspace, config.paths.archive);
      const requestsDir = join(config.system.root, config.paths.workspace, config.paths.requests);
      await ensureDir(activeDir);
      await ensureDir(archiveDir);
      await ensureDir(requestsDir);

      const requestId = "test-request-insight";
      await Deno.writeTextFile(
        join(requestsDir, `${requestId}.md`),
        `---
status: active
---`,
      );

      const traceId = crypto.randomUUID();
      const savedInsights: Insight[] = [];

      const spySessionMemory: Pick<SessionMemoryService, "saveInsight"> = {
        saveInsight(insight: Insight): Promise<SaveInsightResult> {
          savedInsights.push(insight);
          return Promise.resolve({ success: true, learningId: crypto.randomUUID(), message: "ok" });
        },
      };

      const spyExtractor: IMemoryExtractorService = {
        async analyzeExecution(): Promise<IProposalLearning[]> {
          await Promise.resolve();
          return [{
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            source: MemoryBankSource.AGENT,
            scope: MemoryScope.GLOBAL,
            title: "Test learning from execution",
            description: "Auto-extracted learning for saveInsight test",
            category: LearningCategory.INSIGHT,
            tags: ["test"],
            confidence: ConfidenceAssessmentLevel.MEDIUM,
          }];
        },
        createProposal(): Promise<string> {
          return Promise.resolve(crypto.randomUUID());
        },
        listPending: () => Promise.resolve([]),
        getPending: () => Promise.resolve(null),
        approvePending: () => Promise.resolve(),
        rejectPending: () => Promise.resolve(),
        approveAll: () => Promise.resolve(0),
      };

      const context = castAny<IApplicationContext>({
        config: { get: () => config, getChecksum: () => "test" },
        db,
        provider: undefined,
        git: undefined,
        display: undefined,
        notificationService: undefined,
        extractor: spyExtractor,
      });

      const logger = new EventLogger({ db });
      const loop = new ExecutionLoop({
        config,
        db,
        identityId: "test-identity",
        context,
        sessionMemory: spySessionMemory as SessionMemoryService,
        memoryBank: new MemoryBankService(config, logger),
        gitServiceFactory: {
          createGitService(repoPath: string, traceId: string) {
            return new GitService({ config, traceId, identityId: "test-identity", repoPath });
          },
        },
        toolRegistryFactory: {
          createToolRegistry(traceId: string, baseDir: string) {
            return new ToolRegistry({ config, traceId, identityId: "test-identity", baseDir });
          },
        },
      });

      const planContent = `---
trace_id: "${traceId}"
request_id: ${requestId}
status: active
agent_role: test-identity
---

# Test Plan
No actions — will succeed immediately
`;
      const planPath = join(activeDir, `${requestId}.md`);
      await Deno.writeTextFile(planPath, planContent);

      const result = await loop.processTask(planPath);

      assertEquals(result.success, true, `Execution should succeed: ${result.error}`);

      assertEquals(savedInsights.length, 0, "saveInsight must not be called during extraction");
    } finally {
      await cleanup();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
