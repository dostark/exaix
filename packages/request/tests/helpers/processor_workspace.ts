/**
 * @module ProcessorWorkspaceTestHelper
 * @path packages/request/tests/helpers/processor_workspace.ts
 * @description Builds a workspace with a pending request and a RequestProcessor on a stub provider, for tests that run the processor end to end.
 * @architectural-layer Test
 * @related-files [packages/request/tests/processor_agent_runner_journal_test.ts, packages/request/tests/request_processor_task_complexity_test.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_AGENTS_PATH, DEFAULT_PLANS_PATH } from "@exaix/shared";
import { join } from "@std/path";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import type { IAgentRunner } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { ProviderRegistry } from "@exaix/ai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { CostTracker } from "@exaix/core/cost";
import type { IApplicationContext } from "@exaix/core/types";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  getBlueprintsAgentsDir,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

/** What a test gets once the workspace, the pending request, and the processor exist. */
export interface IProcessorWorkspace {
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  traceId: string;
  requestPath: string;
  processor: RequestProcessor;
}

/**
 * Runs `body` with a temporary workspace that holds a default blueprint and one pending request.
 * The processor uses `provider`, and `agentRunner` when given, otherwise a real AgentRunner on `provider`.
 */
export async function withProcessorWorkspace(
  provider: IModelProvider,
  body: (workspace: IProcessorWorkspace) => Promise<void>,
  agentRunner?: IAgentRunner,
): Promise<void> {
  const { db, config, cleanup, tempDir } = await initTestDbService();
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(pathBuilders.workspacePath(tempDir, DEFAULT_PLANS_PATH), { recursive: true });
    await Deno.mkdir(pathBuilders.blueprintsPath(tempDir, DEFAULT_AGENTS_PATH), { recursive: true });
    await Deno.writeTextFile(
      pathBuilders.blueprintsPath(tempDir, DEFAULT_AGENTS_PATH, "default.md"),
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

    const logger = new EventLogger({ db });
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    const processor = new RequestProcessor(
      {
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir: getWorkspaceRequestsDir(tempDir),
        blueprintsPath: getBlueprintsAgentsDir(tempDir),
        includeReasoning: true,
        context,
        testProvider: provider,
        costTracker: new CostTracker(db, config),
        logger,
        agentRunner: agentRunner ?? new AgentRunner(provider),
      } satisfies IRequestProcessorConfig,
    );
    await body({ db, traceId, requestPath, processor });
  } finally {
    await cleanup();
  }
}
