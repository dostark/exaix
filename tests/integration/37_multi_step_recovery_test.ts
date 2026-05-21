/**
 * @module MultiStepRecoveryTest
 * @path tests/integration/37_multi_step_recovery_test.ts
 * @description Integration coverage for Step 63.4 compensation against a real git-backed portal worktree.
 * @architectural-layer Test
 * @related-files [src/flows/flow_runner.ts, packages/mcp/server/handlers/delete_file_tool.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat, FlowStepOnErrorAction, PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import {
  FlowExecutionError,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import { DeleteFileTool } from "@exaix/mcp/server";
import { PortalPermissionsService } from "@exaix/portal";
import { createStubConfig, createStubContext } from "../helpers/test_helpers.ts";
import { GitTestHelper, setupGitRepo } from "@exaix/git/testing";
import { initToolPermissionTest } from "../mcp/helpers/test_setup.ts";

type AgentStepHandler = () => Promise<IAgentExecutionResult>;

class FunctionalAgentExecutor implements IAgentExecutor {
  constructor(private readonly handlers: Record<string, AgentStepHandler>) {}

  async run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const handler = this.handlers[identityId];
    if (!handler) {
      throw new Error(`No handler configured for ${identityId}`);
    }

    return await handler();
  }
}

class RecordingFlowLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

Deno.test("[Step63.4] FlowRunner compensates prior portal changes and leaves the git worktree clean", async () => {
  const env = await initToolPermissionTest({
    initGit: false,
    operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
  });

  try {
    await setupGitRepo(env.portalPath, { initialCommit: true });
    const git = new GitTestHelper(env.portalPath);

    const step1Path = join(env.portalPath, "generated", "step1.txt");
    const step2Path = join(env.portalPath, "generated", "step2.txt");

    const executor = new FunctionalAgentExecutor({
      agent1: async () => {
        await Deno.mkdir(join(env.portalPath, "generated"), { recursive: true });
        await Deno.writeTextFile(step1Path, "step1 output\n");
        return { thought: "step1", content: "step1-result", raw: "step1-result" };
      },
      agent2: async () => {
        await Deno.writeTextFile(step2Path, "step2 output\n");
        return { thought: "step2", content: "step2-result", raw: "step2-result" };
      },
      agent3: () => Promise.reject(new Error("verification failed")),
    });

    const logger = new RecordingFlowLogger();
    const context = createStubContext({
      config: createStubConfig(env.config),
      db: env.db,
    });
    const portalPermissions = {
      ...env.permissions,
      identities_allowed: ["agent1", "agent2", "agent3"],
    };
    const deleteFileTool = new DeleteFileTool(context, new PortalPermissionsService([portalPermissions]));

    const flow: IFlowInput = {
      id: "multi-step-recovery-flow",
      name: "Multi Step Recovery Flow",
      description: "Integration flow compensation coverage against a real portal worktree",
      version: DEFAULT_FLOW_VERSION,
      steps: [
        {
          id: "step1",
          name: "Generate Step 1",
          identity: "agent1",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [{ tool: McpToolName.DELETE_FILE, args: { path: "generated/step1.txt" } }],
          },
        },
        {
          id: "step2",
          name: "Generate Step 2",
          identity: "agent2",
          dependsOn: ["step1"],
          input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [{ tool: McpToolName.DELETE_FILE, args: { path: "generated/step2.txt" } }],
          },
        },
        {
          id: "step3",
          name: "Fail Verification",
          identity: "agent3",
          dependsOn: ["step2"],
          input: { source: FlowInputSource.STEP, stepId: "step2", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: { action: FlowStepOnErrorAction.COMPENSATE },
        },
      ],
      output: { from: "step3", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true },
    };

    const runner = new FlowRunner({
      agentExecutor: executor,
      eventLogger: logger,
      config: env.config,
      mcpHandlers: [deleteFileTool],
    });

    await assertRejects(
      () =>
        runner.execute(flow as IFlow, {
          userPrompt: "exercise real worktree compensation",
          traceId: "trace-functional-compensation-001",
          requestId: "req-functional-compensation-001",
          portal: env.permissions.alias,
        }),
      FlowExecutionError,
    );

    assertEquals(await exists(step1Path), false);
    assertEquals(await exists(step2Path), false);
    await git.assertCleanWorkingDir();

    const compensatedEvents = logger.events.filter((entry) => entry.event === "flow.step.compensated");
    assertEquals(compensatedEvents.length, 2);
    assertEquals(
      compensatedEvents.map((entry) => entry.payload.sourceStepId),
      ["step2", "step1"],
    );
    assertEquals(compensatedEvents.every((entry) => entry.payload.success === true), true);
    assertEquals(logger.events.some((entry) => entry.event === "flow.step.compensation_failed"), false);
  } finally {
    await env.cleanup();
  }
});
