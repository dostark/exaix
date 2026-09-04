/**
 * @module ProcessorAgentRunnerJournalTest
 * @path packages/request/tests/processor_agent_runner_journal_test.ts
 * @description Verifies RequestProcessor.processAgentRequest wraps agentRunner.run() (both the
 *   initial call and the feedback-retry call) with real Activity Journal execution-start/
 *   complete/error rows tagged runnerKind: "agent-runner" — the request/routing pipeline
 *   persisted no such rows before Phase 180 Step 5. Uses a real EventLogger + real DB (not a
 *   mock) because RequestProcessor's default ctx.display stub path drops IEventLogger.log()
 *   calls (see Architecture Notes in the phase plan, Step 5).
 * @architectural-layer Services
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { CostTracker } from "@exaix/core/cost";
import type { IApplicationContext } from "@exaix/core/types";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getBlueprintsAgentsDir,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

Deno.test("[new] RequestProcessor.processAgentRequest logs runner_kind: agent-runner on agentRunner.run() completion", async () => {
  const { db, config, cleanup, tempDir } = await initTestDbService();
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(join(tempDir, "Workspace", "Plans"), { recursive: true });
    await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "Blueprints", "Agents", "default.md"),
      "---\nagent_role: default\n---\n\nYou are a helpful assistant.\n",
    );

    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
    await Deno.writeTextFile(
      requestPath,
      `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Test Request Subject"
---

# Request

Add a hello world function.
`,
    );

    const provider = createStubProvider(
      '<thought>ok</thought><content>{"description": "Mock plan", ' +
        '"steps": [{"step": 1, "title": "Mock step", "description": "Mock step description"}]}</content>',
    );
    const logger = new EventLogger({ db });
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    const costTracker = new CostTracker(db, config);
    const processor = new RequestProcessor(
      {
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir: getWorkspaceRequestsDir(tempDir),
        blueprintsPath: getBlueprintsAgentsDir(tempDir),
        includeReasoning: true,
        context,
        testProvider: provider,
        costTracker,
        logger,
        agentRunner: new AgentRunner(provider),
      } satisfies IRequestProcessorConfig,
    );

    await processor.process(requestPath);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const started = activities.find((a) => a.action_type === "agent.execution_started" && a.runner_kind);
    const completed = activities.find((a) => a.action_type === "agent.execution_completed" && a.runner_kind);
    assert(started, "a queryable Activity Journal row for agent.execution_started must exist");
    assert(completed, "a queryable Activity Journal row for agent.execution_completed must exist");
    assertEquals(started!.runner_kind, "agent-runner");
    assertEquals(completed!.runner_kind, "agent-runner");
  } finally {
    await cleanup();
  }
});

Deno.test("[new] RequestProcessor.processAgentRequest logs runner_kind: agent-runner on both the initial and feedback-retry agentRunner.run() calls", async () => {
  const { db, config, cleanup, tempDir } = await initTestDbService();
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(join(tempDir, "Workspace", "Plans"), { recursive: true });
    await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "Blueprints", "Agents", "default.md"),
      "---\nagent_role: default\n---\n\nYou are a helpful assistant.\n",
    );

    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
    await Deno.writeTextFile(
      requestPath,
      `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Test Request Subject"
---

# Request

Add a hello world function.
`,
    );

    // First response is malformed plan content (triggers PlanValidationError and a retry);
    // second response is a valid plan, so the retry succeeds.
    let callCount = 0;
    const provider = {
      id: "mock-provider",
      generate: () => {
        callCount++;
        const content = callCount === 1
          ? "not valid plan json at all"
          : '{"description": "Mock plan", "steps": [{"step": 1, "title": "Mock step", "description": "Mock step description"}]}';
        return Promise.resolve({
          content: `<thought>ok</thought><content>${content}</content>`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "mock-model",
          provider: "mock-provider",
          cost_usd: 0,
        });
      },
    };
    const logger = new EventLogger({ db });
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    const costTracker = new CostTracker(db, config);
    const processor = new RequestProcessor(
      {
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir: getWorkspaceRequestsDir(tempDir),
        blueprintsPath: getBlueprintsAgentsDir(tempDir),
        includeReasoning: true,
        context,
        testProvider: provider,
        costTracker,
        logger,
        agentRunner: new AgentRunner(provider),
      } satisfies IRequestProcessorConfig,
    );

    await processor.process(requestPath);
    await db.waitForFlush();

    assert(callCount >= 2, "the malformed first response must have triggered a real retry");

    const activities = db.getActivitiesByTrace(traceId);
    const startedRows = activities.filter((a) => a.action_type === "agent.execution_started" && a.runner_kind);
    const completedRows = activities.filter((a) => a.action_type === "agent.execution_completed" && a.runner_kind);
    assertEquals(startedRows.length, 2, "both the initial and feedback-retry calls must log a start row");
    assertEquals(completedRows.length, 2, "both the initial and feedback-retry calls must log a completion row");
    for (const row of [...startedRows, ...completedRows]) {
      assertEquals(row.runner_kind, "agent-runner");
    }
  } finally {
    await cleanup();
  }
});
