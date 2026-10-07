/**
 * @module FlowControlReplayTest
 * @path packages/flow/tests/flow_control_replay_test.ts
 * @description Seeds replayable gate summaries and rejects legacy control checkpoints.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { StepAttemptClass, StepExecutionDisposition, StepSideEffectClass } from "@exaix/core";
import {
  DefaultStepReplayPolicy,
  FlowCheckpointService,
  FlowExecutionError,
  FlowRunner,
  GateEvaluator,
  StepContentHasher,
} from "@exaix/flow";
import type { IStepDurabilityStore, IStepExecutionRecord } from "@exaix/flow";
import { initTestDbService } from "@exaix/testing";
import { GATE_TRACE, GateTestAgent, gateTestFlow, GateTestJudge, GateTestLogger } from "./helpers/gate_controls.ts";

class SeededGateStore implements IStepDurabilityStore {
  readonly records = new Map<string, IStepExecutionRecord>();
  readonly matchedCandidates: string[] = [];
  save(record: IStepExecutionRecord): Promise<void> {
    this.records.set(record.recordId, structuredClone(record));
    return Promise.resolve();
  }
  findReplayCandidate(
    query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    const record = Array.from(this.records.values()).find((value) =>
      value.traceId === query.traceId && value.flowId === query.flowId && value.stepId === query.stepId &&
      value.inputHash === query.inputHash && value.replayEligible
    );
    if (record) this.matchedCandidates.push(record.recordId);
    return Promise.resolve(record ?? null);
  }
  invalidate(recordId: string, _reason: string): Promise<void> {
    this.records.delete(recordId);
    return Promise.resolve();
  }
}
for (const sideEffectClass of [StepSideEffectClass.NONE, StepSideEffectClass.LLM]) {
  Deno.test(`[real-store replay] summary-only ${sideEffectClass} gate cannot bypass evaluation`, async () => {
    const flow = gateTestFlow();
    const hasher = new StepContentHasher();
    const store = new SeededGateStore();
    const userPrompt = "Review this";
    const inputHash = await hasher.computeStepInputHash({ userPrompt, context: {} });
    const prior: IStepExecutionRecord = {
      recordId: "prior-gate",
      traceId: GATE_TRACE,
      flowId: flow.id,
      stepId: "gate",
      idempotencyKey: {
        traceId: GATE_TRACE,
        flowId: flow.id,
        stepId: "gate",
        inputHash,
        attemptClass: StepAttemptClass.INITIAL,
      },
      inputHash,
      disposition: StepExecutionDisposition.EXECUTED,
      startedAt: new Date().toISOString(),
      sideEffectClass,
      replayEligible: true,
      summary: "Previously accepted",
    };
    await store.save(prior);
    const policy = new DefaultStepReplayPolicy();
    assertEquals(
      policy.canReuse({ step: { userPrompt, context: {} }, prior, currentInputHash: inputHash }).allowed,
      true,
    );
    const judge = new GateTestJudge();
    const logger = new GateTestLogger();
    const runner = new FlowRunner({
      agentExecutor: new GateTestAgent(),
      eventLogger: logger,
      gateEvaluator: new GateEvaluator(judge),
      stepDurabilityStore: store,
      stepReplayPolicy: policy,
    });
    await assertRejects(
      () => runner.execute(flow, { userPrompt: "Review this", traceId: GATE_TRACE }),
      FlowExecutionError,
    );
    assertEquals(store.matchedCandidates, ["prior-gate"]);
    assertEquals(judge.calls, 1);
    assertEquals(
      logger.events.filter((entry) => entry.event === "flow.gate.evaluated").map((entry) => entry.payload.traceId),
      [GATE_TRACE],
    );
    assertEquals(
      logger.events.filter((entry) => entry.event === "flow.step.started" && entry.payload.stepId === "after"),
      [],
    );
  });
}
Deno.test("[security] legacy completed gate checkpoint fails before downstream execution", async () => {
  const environment = await initTestDbService();
  try {
    const flow = gateTestFlow();
    const checkpointService = new FlowCheckpointService(environment.config);
    await checkpointService.save(GATE_TRACE, await new StepContentHasher().computeFlowContentHash(flow), {
      gate: {
        stepId: "gate",
        success: true,
        duration: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        result: { thought: "", content: "Previously accepted", raw: "Previously accepted" },
      },
    });
    const logger = new GateTestLogger();
    const agent = new GateTestAgent();
    const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, checkpointService });
    const error = await assertRejects(
      () => runner.execute(flow, { userPrompt: "Review this", traceId: GATE_TRACE }),
      FlowExecutionError,
    );
    assertEquals(error.reasonCode, "flow_control_resume_unsupported");
    assertEquals(agent.calls, []);
  } finally {
    await environment.cleanup();
  }
});
