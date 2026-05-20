/**
 * @module FlowRunnerGateDispatchTest
 * @path tests/flows/flow_runner_gate_dispatch_test.ts
 * @description Tests for FlowRunner gate-step dispatch and requestAnalysis
 * forwarding through IFlowStepRequest (Phase 48 Step 6).
 */

import { assertEquals } from "@std/assert";
import { FlowGateOnFail, FlowInputSource, FlowOutputFormat, FlowStepType } from "@exaix/core";
import {
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import { GateEvaluator, MockJudgeInvoker } from "../../src/flows/gate_evaluator.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";
import { type IRequestAnalysis, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";
import { ANALYZER_VERSION } from "@exaix/core";

// ============================================================
// Mock infrastructure
// ============================================================

class TrackingAgentExecutor implements IAgentExecutor {
  invoked = false;
  lastRequest?: IFlowStepRequest;

  async run(_identityId: string, req: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.invoked = true;
    this.lastRequest = req;
    return await Promise.resolve({ thought: "", content: "agent-result", raw: "agent-result" });
  }
}

class TrackingEventLogger implements IFlowEventLogger {
  events: string[] = [];
  log(event: string, _payload: Record<string, JSONValue | undefined>): void {
    this.events.push(event);
  }
  has(event: string): boolean {
    return this.events.includes(event);
  }
}

function makeAnalysis(): IRequestAnalysis {
  return {
    goals: [{ description: "Goal A", explicit: true, priority: 1 }],
    requirements: [],
    constraints: [],
    acceptanceCriteria: ["AC 1"],
    ambiguities: [],
    actionabilityScore: 90,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.FEATURE,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 5,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

function makeAgentFlow(stepId = "step1"): IFlow {
  const flow: IFlowInput = {
    id: "test-agent-flow",
    name: "Test Agent Flow",
    description: "Agent flow for tests",
    steps: [
      {
        id: stepId,
        name: "Agent Step",
        type: FlowStepType.AGENT,
        identity: "writer-agent",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
    ],
    output: { from: stepId, format: FlowOutputFormat.MARKDOWN },
  };
  return flow as IFlow;
}

function makeGateFlow(includeRequestCriteria = false): IFlow {
  const flow: IFlowInput = {
    id: "test-gate-flow",
    name: "Test Gate Flow",
    description: "Gate flow for tests",
    steps: [
      {
        id: "gate1",
        name: "Quality Gate",
        type: FlowStepType.GATE,
        identity: "judge-agent",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        evaluate: {
          identity: "judge-agent",
          criteria: ["CODE_CORRECTNESS"],
          threshold: 0.8,
          onFail: FlowGateOnFail.HALT,
          maxRetries: 3,
          includeRequestCriteria,
        },
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
    ],
    output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
  };
  return flow as IFlow;
}

// ============================================================
// Tests
// ============================================================

Deno.test("[FlowRunner] dispatches gate steps to GateEvaluator", async () => {
  const mockJudge = new MockJudgeInvoker();
  mockJudge.setDefaultScore(0.9);
  const gateEvaluator = new GateEvaluator(mockJudge);

  const agentExecutor = new TrackingAgentExecutor();
  const logger = new TrackingEventLogger();
  const runner = new FlowRunner({ agentExecutor, eventLogger: logger, gateEvaluator });
  const flow = makeGateFlow();

  const result = await runner.execute(flow, { userPrompt: "Evaluate this" });

  assertEquals(result.success, true);
  // agentExecutor must NOT have been called — gate dispatch uses gateEvaluator
  assertEquals(agentExecutor.invoked, false);
});

Deno.test("[FlowRunner] non-gate steps use agentExecutor", async () => {
  const agentExecutor = new TrackingAgentExecutor();
  const logger = new TrackingEventLogger();

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });
  const flow = makeAgentFlow();

  await runner.execute(flow, { userPrompt: "Do something" });

  assertEquals(agentExecutor.invoked, true);
});

Deno.test("[FlowRunner] requestAnalysis forwarded to IFlowStepRequest", async () => {
  const agentExecutor = new TrackingAgentExecutor();
  const logger = new TrackingEventLogger();

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });
  const flow = makeAgentFlow();
  const analysis = makeAnalysis();

  await runner.execute(flow, { userPrompt: "Do something", requestAnalysis: analysis });

  assertEquals(agentExecutor.lastRequest?.requestAnalysis, analysis);
});

Deno.test("[FlowRunner] gate dispatch preserves includeRequestCriteria from step.evaluate", async () => {
  const mockJudge = new MockJudgeInvoker();
  mockJudge.setDefaultScore(0.9);
  const gateEvaluator = new GateEvaluator(mockJudge);

  const agentExecutor = new TrackingAgentExecutor();
  const logger = new TrackingEventLogger();
  const runner = new FlowRunner({ agentExecutor, eventLogger: logger, gateEvaluator });

  // includeRequestCriteria=true in step config — gate should run without error
  const flow = makeGateFlow(true);
  const result = await runner.execute(flow, { userPrompt: "Evaluate this" });

  assertEquals(result.success, true);
  assertEquals(agentExecutor.invoked, false);
});

Deno.test("[FlowRunner] logs warning when includeRequestCriteria=true but no analysis", async () => {
  const mockJudge = new MockJudgeInvoker();
  mockJudge.setDefaultScore(0.9);
  const gateEvaluator = new GateEvaluator(mockJudge);

  const agentExecutor = new TrackingAgentExecutor();
  const logger = new TrackingEventLogger();
  const runner = new FlowRunner({ agentExecutor, eventLogger: logger, gateEvaluator });

  // Flow with includeRequestCriteria=true but no requestAnalysis provided
  const flow = makeGateFlow(true);
  await runner.execute(flow, { userPrompt: "Evaluate this" });

  assertEquals(logger.has("flow.gate.criteria.no_analysis"), true);
});
