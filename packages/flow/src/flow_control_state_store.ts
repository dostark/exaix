/**
 * @module FlowControlStateStore
 * @path packages/flow/src/flow_control_state_store.ts
 * @description Keeps gate counters isolated per run and verifies resumed verdict identities.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/flow/src/flow_checkpoint_coordinator.ts]
 */
import { DEFAULT_FLOW_GATE_MAX_EVALUATIONS, FlowGateAction, FlowStepType } from "@exaix/core";
import type { BindingOutcome, IBindingRunSnapshot } from "@exaix/schemas";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IFlowCheckpointRequest } from "./flow_checkpoint_coordinator.ts";
import { FlowExecutionError, type IStepResult } from "./flow_runner.ts";
import { FLOW_CONTROL_RESUME_UNSUPPORTED_CODE } from "./errors/flow_control_errors.ts";
import type { IFlowControlState, IGateLoopState } from "./contracts/flow_control_state.ts";
import { StepContentHasher } from "./step_content_hasher.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { computeLoopBody } from "./loop_body.ts";
interface IDefaultModelIdentity {
  ai: Config["ai"] | null;
  models: Config["models"] | null;
}
interface IBindingFingerprintIdentity {
  bindings: Array<[string, BindingOutcome]>;
  lock?: string;
  envIgnored: boolean;
  configDefaultModel?: string;
}
export interface IFlowControlRunContext {
  state: IFlowControlState;
  ceiling: number;
  flowContentHash: string;
  defaultModelIdentity?: IDefaultModelIdentity;
}
export class FlowControlStateStore {
  private readonly runs = new WeakMap<Map<string, IStepResult>, IFlowControlRunContext>();
  initialize(
    results: Map<string, IStepResult>,
    ceiling: number,
    flowContentHash: string,
    defaultModelIdentity: IDefaultModelIdentity = { ai: null, models: null },
  ): void {
    this.runs.set(results, { state: { gates: {} }, ceiling, flowContentHash, defaultModelIdentity });
  }
  get(results: Map<string, IStepResult>): IFlowControlRunContext {
    return this.runs.get(results) ??
      { state: { gates: {} }, ceiling: DEFAULT_FLOW_GATE_MAX_EVALUATIONS, flowContentHash: "" };
  }
  async fingerprint(
    flow: IFlow,
    gate: IFlowStep,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
  ): Promise<string> {
    const run = this.get(results);
    const inputs = [
      ...new Set([
        ...computeLoopBody(flow, gate),
        ...gate.dependsOn,
        ...(gate.input.from ?? []),
        ...(gate.input.stepId ? [gate.input.stepId] : []),
      ]),
    ]
      .sort().map((id) => [id, results.get(id)?.result?.content ?? null]);
    return await new StepContentHasher().computeStringHash(
      JSON.stringify({
        flowContentHash: run.flowContentHash,
        gate: gate.evaluate,
        ceiling: run.ceiling,
        inputs,
        userPrompt: request.userPrompt,
        portal: request.portal,
        executionRoot: request.executionRoot,
        planContextRef: request.planContextRef,
        requestId: request.requestId,
        requestSha256: request.requestSha256,
        defaultModelIdentity: run.defaultModelIdentity,
        requestAnalysis: request.requestAnalysis,
        bindings: bindingIdentity(request.bindingSnapshot),
      }),
    );
  }
  async restore(
    state: IFlowControlState,
    flow: IFlow,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
    flowRunId: string,
  ): Promise<void> {
    for (const [id, gateState] of Object.entries(state.gates)) {
      const gate = flow.steps.find((step) => step.id === id);
      if (
        !gate || !this.isSettled(gateState, gate, flow, results) ||
        gateState.fingerprint !== await this.fingerprint(flow, gate, request, results)
      ) {
        throw new FlowExecutionError(
          `Gate '${id}' cannot safely resume`,
          flowRunId,
          FLOW_CONTROL_RESUME_UNSUPPORTED_CODE,
        );
      }
    }
    this.get(results).state = state;
  }
  private isSettled(state: IGateLoopState, gate: IFlowStep, flow: IFlow, results: Map<string, IStepResult>): boolean {
    return gate.type === FlowStepType.GATE && gate.evaluate !== undefined && state.phase === "settled" &&
      state.gateId === gate.id && state.result !== undefined &&
      state.result.action !== FlowGateAction.RETRY && state.evaluationCount === state.result.attempts &&
      state.evaluationCount <= (gate.evaluate?.maxRetries ?? 3) &&
      state.ceiling === this.get(results).ceiling &&
      JSON.stringify(state.bodyIds) === JSON.stringify(computeLoopBody(flow, gate));
  }
}
function bindingIdentity(
  snapshot: Opt<IBindingRunSnapshot, Reason.OptionalContext>,
): IBindingFingerprintIdentity | null {
  if (!snapshot) return null;
  return {
    bindings: [...snapshot.bindings.entries()].sort(([a], [b]) => a.localeCompare(b)),
    lock: snapshot.lock?.sha256,
    envIgnored: snapshot.envIgnored,
    configDefaultModel: snapshot.layers.configDefaultModel,
  };
}
