/**
 * @module FlowGateCriteriaTest
 * @path tests/flows/flow_gate_criteria_test.ts
 * @description Tests that flow-level includeRequestCriteria in FlowSchema.settings
 * propagates to all gate steps unless overridden at the step level (Phase 48, Step 11).
 */

import { assertEquals } from "@std/assert";
import { FlowGateOnFail, FlowInputSource, FlowOutputFormat, FlowStepType } from "@exaix/core";
import { FlowRunner, type IAgentExecutor, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import { GateEvaluator, MockJudgeInvoker } from "@exaix/flow";
import type { IGateConfig, IGateResult } from "@exaix/core/types";
import { FlowSchema, type IFlow, type IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";

// Mock infrastructure

class StubAgentExecutor implements IAgentExecutor {
  async run(_identityId: string, _req: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return await Promise.resolve({ thought: "", content: "agent-result", raw: "agent-result" });
  }
}

class SilentEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

/** Captures the GateConfig passed to evaluate() for assertions */
class CapturingGateEvaluator extends GateEvaluator {
  capturedConfig?: IGateConfig;

  override async evaluate(
    config: IGateConfig,
    contentToEvaluate: string,
    context?: string,
    previousAttempts: number = 0,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<IGateResult> {
    this.capturedConfig = config;
    return await super.evaluate(config, contentToEvaluate, context, previousAttempts, requestAnalysis);
  }
}

// Helpers

function makeGateFlow(
  stepIncludeRequestCriteria?: boolean,
  flowIncludeRequestCriteria?: boolean,
): IFlow {
  const raw: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    ...(flowIncludeRequestCriteria !== undefined
      ? { settings: { includeRequestCriteria: flowIncludeRequestCriteria } }
      : {}),
    steps: [
      {
        id: "gate1",
        name: "Quality Gate",
        type: FlowStepType.GATE,
        agent_role: "judge",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        evaluate: {
          agent_role: "judge",
          criteria: ["code_correctness"],
          threshold: 0.05,
          onFail: FlowGateOnFail.HALT,
          maxRetries: 1,
          ...(stepIncludeRequestCriteria !== undefined ? { includeRequestCriteria: stepIncludeRequestCriteria } : {}),
        },
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
    ],
    output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
  };
  // Parse through Zod so settings defaults (including includeRequestCriteria) are populated
  return FlowSchema.parse(raw);
}

// Tests

Deno.test(
  "[FlowRunner] applies flow-level includeRequestCriteria to gate steps",
  async () => {
    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const capturing = new CapturingGateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new SilentEventLogger(),
      gateEvaluator: capturing,
    });
    // Flow has flow-level true; step has no explicit setting (defaults to false)
    const flow = makeGateFlow(undefined, true);

    await runner.execute(flow, { userPrompt: "test" });

    // Effective flag must be true because flow-level default propagated
    assertEquals(capturing.capturedConfig?.includeRequestCriteria, true);
  },
);

Deno.test(
  "[FlowRunner] step-level overrides flow-level setting",
  async () => {
    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const capturing = new CapturingGateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new SilentEventLogger(),
      gateEvaluator: capturing,
    });
    // Step explicitly sets true; flow has no setting (defaults false)
    const flow = makeGateFlow(true, false);

    await runner.execute(flow, { userPrompt: "test" });

    assertEquals(capturing.capturedConfig?.includeRequestCriteria, true);
  },
);

Deno.test(
  "[FlowRunner] existing flows work without includeRequestCriteria",
  async () => {
    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const capturing = new CapturingGateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new SilentEventLogger(),
      gateEvaluator: capturing,
    });
    // Neither flow nor step sets includeRequestCriteria → both default to false
    const flow = makeGateFlow(undefined, undefined);

    const result = await runner.execute(flow, { userPrompt: "test" });

    assertEquals(result.success, true);
    assertEquals(capturing.capturedConfig?.includeRequestCriteria, false);
  },
);

const MINIMAL_STEP = {
  id: "s1",
  name: "S1",
  type: FlowStepType.AGENT,
  agent_role: "agent",
  dependsOn: [],
  input: { source: FlowInputSource.REQUEST },
  retry: { maxAttempts: 1, backoffMs: 0 },
};

Deno.test(
  "[FlowSchema] settings.includeRequestCriteria defaults to false",
  () => {
    const flow = FlowSchema.parse({
      id: "f",
      name: "F",
      description: "D",
      steps: [MINIMAL_STEP],
      output: { from: "s1" },
    });
    assertEquals(flow.settings.includeRequestCriteria, false);
  },
);

Deno.test(
  "[FlowSchema] settings.includeRequestCriteria can be set to true",
  () => {
    const flow = FlowSchema.parse({
      id: "f",
      name: "F",
      description: "D",
      steps: [MINIMAL_STEP],
      output: { from: "s1" },
      settings: { includeRequestCriteria: true },
    });
    assertEquals(flow.settings.includeRequestCriteria, true);
  },
);
