/**
 * @module FlowCompensationTest
 * @path tests/integration/services/flow_compensation_test.ts
 * @description Integration coverage for Step 63.4 compensating transactions.
 * @architectural-layer Test
 * @related-files [src/flows/flow_runner.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepOnErrorAction, McpToolName } from "../../../src/shared/enums.ts";
import {
  FlowExecutionError,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "../../../src/shared/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../../src/services/agent/agent_runner.ts";
import { DEFAULT_FLOW_VERSION } from "../../../src/shared/constants.ts";
import type { JSONValue } from "../../../src/shared/types/json.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { ToolHandler } from "../../../src/mcp/tool_handler.ts";
import type { MCPToolResponse } from "../../../src/shared/schemas/mcp.ts";

class SequencedAgentExecutor implements IAgentExecutor {
  private readonly sequences = new Map<string, Array<IAgentExecutionResult | Error>>();

  constructor(sequences: Record<string, Array<IAgentExecutionResult | Error | string>>) {
    for (const [identityId, entries] of Object.entries(sequences)) {
      this.sequences.set(
        identityId,
        entries.map((entry) => {
          if (typeof entry === "string") {
            return { thought: "mock-thought", content: entry, raw: entry };
          }
          return entry;
        }),
      );
    }
  }

  async run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const queue = this.sequences.get(identityId);
    if (!queue || queue.length === 0) {
      throw new Error(`No sequenced result configured for ${identityId}`);
    }

    const next = queue.shift()!;
    if (next instanceof Error) {
      throw next;
    }

    return await Promise.resolve(next);
  }
}

class RecordingFlowLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

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

Deno.test("[Step63.4] FlowRunner executes compensations in LIFO order and continues after compensation failure", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    RecordingDeleteFileTool.calls = [];

    const traceId = "trace-flow-compensation-001";
    const requestId = "req-flow-compensation-001";
    const portal = "TestPortal";

    const flow: IFlowInput = {
      id: "compensation-flow",
      name: "Compensation Flow",
      description: "Flow compensation integration coverage",
      version: DEFAULT_FLOW_VERSION,
      steps: [
        {
          id: "step1",
          name: "Step 1",
          identity: "agent1",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [
              {
                tool: McpToolName.DELETE_FILE,
                args: { path: "rollback/step1-success" },
              },
            ],
          },
        },
        {
          id: "step2",
          name: "Step 2",
          identity: "agent2",
          dependsOn: ["step1"],
          input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [
              {
                tool: McpToolName.DELETE_FILE,
                args: { path: "rollback/step2-fail" },
              },
              {
                tool: McpToolName.DELETE_FILE,
                args: { path: "rollback/step2-success" },
              },
            ],
          },
        },
        {
          id: "step3",
          name: "Step 3",
          identity: "agent3",
          dependsOn: ["step2"],
          input: { source: FlowInputSource.STEP, stepId: "step2", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
          },
        },
      ],
      output: { from: "step3", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 3, failFast: true },
    };

    const executor = new SequencedAgentExecutor({
      agent1: ["step1-result"],
      agent2: ["step2-result"],
      agent3: [new Error("step3 exploded")],
    });

    const logger = new RecordingFlowLogger();
    const compensationContext = createStubContext({ config: createStubConfig(config) });
    const deleteFileTool = new RecordingDeleteFileTool(compensationContext);

    const runner = new FlowRunner({
      agentExecutor: executor,
      eventLogger: logger,
      config,
      mcpHandlers: [deleteFileTool],
    });

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

    const flow: IFlowInput = {
      id: "same-wave-compensation-flow",
      name: "Same Wave Compensation Flow",
      description: "Ensures tied same-wave completions compensate in reverse declaration order",
      version: DEFAULT_FLOW_VERSION,
      steps: [
        {
          id: "stepA",
          name: "Step A",
          identity: "agentA",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [{ tool: McpToolName.DELETE_FILE, args: { path: "rollback/stepA" } }],
          },
        },
        {
          id: "stepB",
          name: "Step B",
          identity: "agentB",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: {
            action: FlowStepOnErrorAction.COMPENSATE,
            compensate: [{ tool: McpToolName.DELETE_FILE, args: { path: "rollback/stepB" } }],
          },
        },
        {
          id: "stepFail",
          name: "Failing Step",
          identity: "agentFail",
          dependsOn: ["stepA", "stepB"],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: 1000 },
          onError: { action: FlowStepOnErrorAction.COMPENSATE },
        },
      ],
      output: { from: "stepFail", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 2, failFast: true },
    };

    const executor = new SequencedAgentExecutor({
      agentA: ["stepA-result"],
      agentB: ["stepB-result"],
      agentFail: [new Error("stepFail exploded")],
    });

    const logger = new RecordingFlowLogger();
    const compensationContext = createStubContext({ config: createStubConfig(config) });
    const deleteFileTool = new RecordingDeleteFileTool(compensationContext);

    const runner = new FlowRunner({
      agentExecutor: executor,
      eventLogger: logger,
      config,
      mcpHandlers: [deleteFileTool],
    });

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
