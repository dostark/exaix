/**
 * @module FlowRunnerAnalysisPropagationTest
 * @path tests/flows/flow_runner_analysis_propagation_test.ts
 * @description Tests that IRequestAnalysis (extracted from PlanFrontmatter by a
 * caller) is correctly propagated through FlowRunner.execute() to gate evaluators
 * (Phase 48, Step 10).
 */

import { assertEquals } from "@std/assert";
import { FlowGateOnFail, FlowInputSource, FlowOutputFormat, FlowStepType } from "../../src/shared/enums.ts";
import { ANALYZER_VERSION } from "../../src/shared/constants.ts";
import {
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import { type GateConfig, GateEvaluator, type IGateResult, MockJudgeInvoker } from "../../src/flows/gate_evaluator.ts";
import type { IFlow, IFlowInput } from "../../src/shared/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../src/services/agent/agent_runner.ts";
import type { JSONValue } from "../../src/shared/types/json.ts";
import {
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../src/shared/types/request.ts";
import { PlanFrontmatterSchema } from "../../src/shared/schemas/plan_schema.ts";
import { PlanStatus } from "../../src/shared/status/plan_status.ts";

// ============================================================
// Mock infrastructure
// ============================================================

class StubAgentExecutor implements IAgentExecutor {
  async run(
    _identityId: string,
    _req: IFlowStepRequest,
  ): Promise<IAgentExecutionResult> {
    return await Promise.resolve({
      thought: "",
      content: "agent-result",
      raw: "agent-result",
    });
  }
}

class TrackingEventLogger implements IFlowEventLogger {
  events: string[] = [];
  log(event: string, _payload: Record<string, JSONValue | undefined>): void {
    this.events.push(event);
  }
}

/**
 * Captures the requestAnalysis passed to evaluate() — useful for verifying
 * that plan-frontmatter analysis propagates all the way to the gate evaluator.
 */
class CapturingGateEvaluator extends GateEvaluator {
  capturedAnalysis?: IRequestAnalysis;

  override async evaluate(
    config: GateConfig,
    contentToEvaluate: string,
    context?: string,
    previousAttempts: number = 0,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<IGateResult> {
    this.capturedAnalysis = requestAnalysis;
    return await super.evaluate(
      config,
      contentToEvaluate,
      context,
      previousAttempts,
      requestAnalysis,
    );
  }
}

// ============================================================
// Helpers
// ============================================================

function makeRawAnalysis(): IRequestAnalysis {
  return {
    goals: [{ description: "Build feature X", explicit: true, priority: 1 }],
    requirements: [],
    constraints: [],
    acceptanceCriteria: ["Feature X must be testable"],
    ambiguities: [],
    actionabilityScore: 85,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.FEATURE,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 10,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

function makeGateFlow(): IFlow {
  const flow: IFlowInput = {
    id: "test-gate-flow",
    name: "Gate Flow",
    description: "Gate flow",
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
          criteria: ["code_correctness"],
          threshold: 0.05,
          onFail: FlowGateOnFail.HALT,
          maxRetries: 1,
          includeRequestCriteria: true,
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

Deno.test(
  "[FlowRunner] receives requestAnalysis from plan frontmatter on execution",
  async () => {
    // Simulate caller extracting request_analysis from plan frontmatter
    const rawAnalysis = makeRawAnalysis();
    const planFrontmatter = PlanFrontmatterSchema.parse({
      status: PlanStatus.ACTIVE,
      request_analysis: rawAnalysis,
    });

    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const capturingEvaluator = new CapturingGateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new TrackingEventLogger(),
      gateEvaluator: capturingEvaluator,
    });
    const flow = makeGateFlow();

    await runner.execute(flow, {
      userPrompt: "Evaluate implementation",
      requestAnalysis: planFrontmatter.request_analysis,
    });

    // Gate evaluator must have received the analysis from plan frontmatter
    assertEquals(capturingEvaluator.capturedAnalysis, planFrontmatter.request_analysis);
  },
);

Deno.test(
  "[FlowRunner] executes normally when plan has no request_analysis field",
  async () => {
    // Simulate old plan without request_analysis in frontmatter
    const planFrontmatter = PlanFrontmatterSchema.parse({
      status: PlanStatus.ACTIVE,
      // no request_analysis
    });

    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const capturingEvaluator = new CapturingGateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new TrackingEventLogger(),
      gateEvaluator: capturingEvaluator,
    });
    const flow = makeGateFlow();

    const result = await runner.execute(flow, {
      userPrompt: "Evaluate implementation",
      requestAnalysis: planFrontmatter.request_analysis, // undefined
    });

    // Flow must succeed even without analysis
    assertEquals(result.success, true);
    // Gate evaluator received undefined analysis
    assertEquals(capturingEvaluator.capturedAnalysis, undefined);
  },
);

Deno.test(
  "[FlowRunner/GateEvaluator] handles flow request without requestAnalysis, uses static criteria only",
  async () => {
    // No requestAnalysis at all — gate must fall back to static criteria
    const mockJudge = new MockJudgeInvoker();
    mockJudge.setDefaultScore(0.9);
    const gateEvaluator = new GateEvaluator(mockJudge);

    const runner = new FlowRunner({
      agentExecutor: new StubAgentExecutor(),
      eventLogger: new TrackingEventLogger(),
      gateEvaluator: gateEvaluator,
    });
    const flow = makeGateFlow();

    // Execute WITHOUT any requestAnalysis
    const result = await runner.execute(flow, { userPrompt: "Evaluate" });

    // Must succeed using static criteria only (no dynamic criteria added since no analysis)
    assertEquals(result.success, true);
  },
);
