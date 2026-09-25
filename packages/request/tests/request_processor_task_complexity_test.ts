/**
 * @module RequestProcessorTaskComplexityTest
 * @path packages/request/tests/request_processor_task_complexity_test.ts
 * @description Integration test verifying RequestProcessor.processAgentRequest stamps the
 *   IParsedRequest it hands to AgentRunner.run with the TaskComplexityClassifier's result
 *   (taskComplexity + taskComplexitySource), so AgentRunner's EffortResolver can resolve
 *   "auto" from the same complexity signal the provider selector used (GAP-2).
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts, packages/request/src/task_complexity_classifier.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import type { IAgentRunner, IBlueprint, IParsedRequest } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier, TaskComplexity } from "@exaix/core";
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

const VALID_PLAN = JSON.stringify({
  subject: "Test",
  description: "A plan.",
  steps: [{ step: 1, title: "Step", description: "Do it." }],
});

function makeCapturingRunner() {
  let capturedRequest: IParsedRequest | undefined;
  const runner: IAgentRunner = {
    async run(blueprint: IBlueprint, request: IParsedRequest): Promise<never> {
      await Promise.resolve();
      capturedRequest = request;
      void blueprint;
      throw new Error("captured");
    },
  };
  return { runner, getCaptured: () => capturedRequest };
}

Deno.test("[RequestProcessor] the IParsedRequest passed to AgentRunner.run carries taskComplexity and taskComplexitySource", async () => {
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
      `<thought>ok</thought><content>${VALID_PLAN}</content>`,
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
    const { runner, getCaptured } = makeCapturingRunner();
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
        agentRunner: runner,
      } satisfies IRequestProcessorConfig,
    );

    // The capturing runner deliberately throws after recording the request; process()
    // routes that through the rejected-plan handler and returns null. The capture is
    // what matters here.
    await processor.process(requestPath);

    const captured = getCaptured();
    assert(captured, "AgentRunner.run must have been called");
    assert(
      Object.values(TaskComplexity).includes(captured.taskComplexity as TaskComplexity),
      `taskComplexity must be a valid TaskComplexity, got ${captured.taskComplexity}`,
    );
    assertEquals(
      ["analysis", "content_heuristic", "agent_role", "default"].includes(captured.taskComplexitySource ?? ""),
      true,
      `taskComplexitySource must be one of the four sources, got ${captured.taskComplexitySource}`,
    );
  } finally {
    await cleanup();
  }
});
