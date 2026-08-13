/**
 * @module FlowCompensationTest
 * @path tests/integration/services/flow_compensation_test.ts
 * @description Integration coverage for Step 63.4 compensating transactions.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepOnErrorAction } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { FlowExecutionError, FlowRunner } from "@exaix/flow";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubContext } from "@exaix/testing";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../../helpers/flow_namespace_test_helper.ts";
import { LocalToolDispatcher, ToolHandler } from "@exaix/mcp/server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { Config } from "@exaix/schemas/config.ts";

class RecordingDeleteFileTool extends ToolHandler {
  static calls: Array<Record<string, JSONValue>> = [];

  execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const path = String(args.path ?? "");
    RecordingDeleteFileTool.calls.push({ ...args });

    if (path.includes("fail")) {
      throw new Error(`Compensation failed for path: ${path}`);
    }

    return Promise.resolve({
      content: [{ type: "text", text: `deleted ${path}` }],
    });
  }

  getToolDefinition() {
    return {
      name: McpToolName.DELETE_FILE,
      description: "Mock compensation tool",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    };
  }
}

function makeCompensationRunner(
  config: Config,
  executor: ScriptedAgentExecutor,
): { runner: FlowRunner; logger: RecordingFlowLogger } {
  const logger = new RecordingFlowLogger();
  const compensationContext = createStubContext({ config: createStubConfig(config) });
  const deleteFileTool = new RecordingDeleteFileTool(compensationContext);
  const runner = new FlowRunner({
    agentExecutor: executor,
    eventLogger: logger,
    config,
    mcpClient: new LocalToolDispatcher(compensationContext, [deleteFileTool]),
  });
  return { runner, logger };
}

function createRetryConfig() {
  return { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS };
}

function createCompensationStep(
  id: string,
  name: string,
  identity: string,
  dependsOn: string[],
  compensationPaths: string[],
) {
  return {
    id,
    name,
    identity,
    dependsOn,
    input: {
      source: dependsOn.length === 0 ? FlowInputSource.REQUEST : FlowInputSource.STEP,
      ...(dependsOn.length === 0 ? {} : { stepId: dependsOn[0] }),
      transform: "passthrough",
    },
    retry: createRetryConfig(),
    onError: {
      action: FlowStepOnErrorAction.COMPENSATE,
      backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS,
      maxRetries: 0,
      ...(compensationPaths.length === 0 ? {} : {
        compensate: compensationPaths.map((path) => ({
          tool: McpToolName.DELETE_FILE,
          args: { path },
        })),
      }),
    },
  };
}

interface ICreateCompensationFlowOpts {
  id: string;
  name: string;
  description: string;
  steps: IFlowInput["steps"];
  outputFrom: string;
  maxParallelism: number;
  failFast: boolean;
}

function createCompensationFlow(opts: ICreateCompensationFlowOpts): IFlowInput {
  const { id, name, description, steps, outputFrom, maxParallelism, failFast } = opts;
  return {
    id,
    name,
    description,
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: outputFrom, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism, failFast },
  };
}

Deno.test("[Step63.4] FlowRunner executes compensations in LIFO order and continues after compensation failure", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    RecordingDeleteFileTool.calls = [];

    const traceId = "trace-flow-compensation-001";
    const requestId = "req-flow-compensation-001";
    const portal = "TestPortal";

    const flow = createCompensationFlow({
      id: "compensation-flow",
      name: "Compensation Flow",
      description: "Flow compensation integration coverage",
      steps: [
        createCompensationStep("step1", "Step 1", "agent1", [], ["rollback/step1-success"]),
        createCompensationStep("step2", "Step 2", "agent2", ["step1"], [
          "rollback/step2-fail",
          "rollback/step2-success",
        ]),
        createCompensationStep("step3", "Step 3", "agent3", ["step2"], []),
      ],
      outputFrom: "step3",
      maxParallelism: 3,
      failFast: true,
    });

    const executor = new ScriptedAgentExecutor({
      agent1: ["step1-result"],
      agent2: ["step2-result"],
      agent3: [new Error("step3 exploded")],
    });

    const { runner, logger } = makeCompensationRunner(config, executor);

    await assertRejects(
      () => runner.execute(flow as IFlow, { userPrompt: "trigger compensation", traceId, requestId, portal }),
      FlowExecutionError,
    );

    assertEquals(
      RecordingDeleteFileTool.calls.map((call) => call.path),
      ["rollback/step2-fail", "rollback/step2-success", "rollback/step1-success"],
    );
    assertEquals(RecordingDeleteFileTool.calls.every((call) => call.portal === portal), true);

    assertEquals(logger.events.some((entry) => entry.event === "flow.step.compensation_failed"), true);

    const compensatedEvents = logger.events.filter((entry) => entry.event === "flow.step.compensated");
    assertEquals(compensatedEvents.length, 3);
  } finally {
    await cleanup();
  }
});

Deno.test("[Step63.11] FlowRunner compensates same-wave steps in reverse declaration order when timestamps tie", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    RecordingDeleteFileTool.calls = [];

    const traceId = "trace-flow-compensation-same-wave";
    const requestId = "req-flow-compensation-same-wave";
    const fixedTimestamp = new Date("2026-04-09T00:00:00.000Z").getTime();
    const RealDate = Date;

    class FixedDate extends RealDate {
      constructor(value?: string | number | Date) {
        super(value ?? fixedTimestamp);
      }

      static override now(): number {
        return fixedTimestamp;
      }

      static override parse(dateString: string): number {
        return RealDate.parse(dateString);
      }

      static override UTC(...args: [number, number, number?, number?, number?, number?, number?]): number {
        return RealDate.UTC(...args);
      }
    }

    const flow = createCompensationFlow({
      id: "same-wave-compensation-flow",
      name: "Same Wave Compensation Flow",
      description: "Ensures tied same-wave completions compensate in reverse declaration order",
      steps: [
        createCompensationStep("stepA", "Step A", "agentA", [], ["rollback/stepA"]),
        createCompensationStep("stepB", "Step B", "agentB", [], ["rollback/stepB"]),
        createCompensationStep("stepFail", "Failing Step", "agentFail", ["stepA", "stepB"], []),
      ],
      outputFrom: "stepFail",
      maxParallelism: 2,
      failFast: true,
    });

    const executor = new ScriptedAgentExecutor({
      agentA: ["stepA-result"],
      agentB: ["stepB-result"],
      agentFail: [new Error("stepFail exploded")],
    });

    const { runner, logger } = makeCompensationRunner(config, executor);

    globalThis.Date = FixedDate as DateConstructor;

    try {
      await assertRejects(
        () => runner.execute(flow as IFlow, { userPrompt: "trigger same-wave compensation", traceId, requestId }),
        FlowExecutionError,
      );
    } finally {
      globalThis.Date = RealDate;
    }

    assertEquals(
      RecordingDeleteFileTool.calls.map((call) => call.path),
      ["rollback/stepB", "rollback/stepA"],
    );

    const compensatedEvents = logger.events.filter((entry) => entry.event === "flow.step.compensated");
    assertEquals(
      compensatedEvents.map((entry) => entry.payload.sourceStepId),
      ["stepB", "stepA"],
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[Step63.12] FlowRunner marks compensated steps with recovery metadata", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    RecordingDeleteFileTool.calls = [];

    const flow = createCompensationFlow({
      id: "compensation-metadata-flow",
      name: "Compensation Metadata Flow",
      description: "Tracks runtime compensation metadata on successful steps",
      steps: [
        createCompensationStep("step1", "Step 1", "agent1", [], ["rollback/step1"]),
        createCompensationStep("step2", "Step 2", "agent2", ["step1"], ["rollback/step2"]),
        createCompensationStep("step3", "Step 3", "agent3", ["step2"], []),
      ],
      outputFrom: "step3",
      maxParallelism: 3,
      failFast: false,
    });

    const executor = new ScriptedAgentExecutor({
      agent1: ["step1-result"],
      agent2: ["step2-result"],
      agent3: [new Error("step3 exploded")],
    });

    const { runner, logger: _logger } = makeCompensationRunner(config, executor);

    const result = await runner.execute(flow as IFlow, { userPrompt: "trigger compensation metadata" });

    assertEquals(result.success, false);
    assertEquals(result.stepResults.get("step1")?.compensationRan, true);
    assertEquals(result.stepResults.get("step2")?.compensationRan, true);
    assertEquals(result.stepResults.get("step1")?.wasRetried, undefined);
    assertEquals(result.stepResults.get("step2")?.fallbackUsed, undefined);
  } finally {
    await cleanup();
  }
});
