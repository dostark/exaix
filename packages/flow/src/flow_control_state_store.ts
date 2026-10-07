/**
 * @module FlowControlStateStore
 * @path packages/flow/src/flow_control_state_store.ts
 * @description Keeps gate counters isolated per run and verifies resumed verdict identities.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/flow/src/flow_checkpoint_coordinator.ts]
 */
import { DEFAULT_FLOW_GATE_MAX_EVALUATIONS, FlowGateAction, FlowStepSkipCode, FlowStepType } from "@exaix/core";
import type { BindingOutcome, IBindingRunSnapshot } from "@exaix/schemas";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IFlowCheckpointRequest } from "./flow_checkpoint_coordinator.ts";
import { FlowExecutionError, type IStepResult } from "./flow_runner.ts";
import { FLOW_CONTROL_RESUME_UNSUPPORTED_CODE } from "./errors/flow_control_errors.ts";
import type { IBranchExecutionResult, IFlowControlState, IGateLoopState } from "./contracts/flow_control_state.ts";
import { parseBranchOutput } from "./step_handlers/branch_step_handler.ts";
import { branchSkipReason } from "./branch_routing.ts";
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
    this.runs.set(results, { state: { gates: {}, branches: {} }, ceiling, flowContentHash, defaultModelIdentity });
  }
  get(results: Map<string, IStepResult>): IFlowControlRunContext {
    return this.runs.get(results) ??
      { state: { gates: {}, branches: {} }, ceiling: DEFAULT_FLOW_GATE_MAX_EVALUATIONS, flowContentHash: "" };
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
    await this.restoreBranches(state, flow, request, results, flowRunId);
    this.get(results).state = state;
  }
  async settleBranch(
    flow: IFlow,
    step: IFlowStep,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
    execution: IBranchExecutionResult,
  ): Promise<void> {
    const { decision, thought, content, raw } = execution;
    const branch = {
      phase: "settled" as const,
      decision,
      inputIds: [...results.keys()].sort(),
      result: { thought, content, raw },
      fingerprint: "pending",
    };
    branch.fingerprint = await this.branchFingerprint(flow, step, request, results, branch);
    this.get(results).state.branches[step.id] = branch;
  }
  private async branchFingerprint(
    flow: IFlow,
    step: IFlowStep,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
    branch: IFlowControlState["branches"][string],
  ): Promise<string> {
    return await new StepContentHasher().computeStringHash(JSON.stringify({
      identity: await this.fingerprint(flow, step, request, results),
      config: { branches: step.branches, default: step.default, input: step.input, name: step.name },
      inputs: branch.inputIds.map((id) => {
        const result = results.get(id);
        return [
          id,
          result?.result?.content ?? null,
          result?.skipCode ?? null,
          result?.success,
          result?.skipped,
          result?.duration,
          result?.error,
        ];
      }),
      result: branch.result,
      decision: branch.decision,
    }));
  }
  private async restoreBranches(
    state: IFlowControlState,
    flow: IFlow,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
    flowRunId: string,
  ): Promise<void> {
    for (const [id, branch] of Object.entries(state.branches)) {
      const step = flow.steps.find((candidate) => candidate.id === id);
      if (!step || !await this.branchStateMatches(flow, step, request, results, id, branch)) {
        throw new FlowExecutionError(
          "Branch checkpoint cannot safely resume",
          flowRunId,
          FLOW_CONTROL_RESUME_UNSUPPORTED_CODE,
        );
      }
    }
    for (const step of flow.steps) {
      const completed = results.get(step.id);
      if (completed && !this.routeResultMatches(step, completed, results, state)) {
        throw new FlowExecutionError(
          "Branch skip checkpoint cannot safely resume",
          flowRunId,
          FLOW_CONTROL_RESUME_UNSUPPORTED_CODE,
        );
      }
    }
  }
  private routeResultMatches(
    step: IFlowStep,
    completed: IStepResult,
    results: Map<string, IStepResult>,
    state: IFlowControlState,
  ): boolean {
    return branchSkipReason(step, results, state)
      ? completed.skipped === true && completed.skipCode === FlowStepSkipCode.BRANCH_NOT_TAKEN
      : completed.skipCode !== FlowStepSkipCode.BRANCH_NOT_TAKEN;
  }
  private async branchStateMatches(
    flow: IFlow,
    step: IFlowStep,
    request: IFlowCheckpointRequest,
    results: Map<string, IStepResult>,
    id: string,
    branch: IFlowControlState["branches"][string],
  ): Promise<boolean> {
    if (step.type !== FlowStepType.BRANCH || branch.decision.branchId !== id) return false;
    const targets = [
      ...new Set([
        ...(step.branches ?? []).map((candidate) => candidate.goto),
        ...(step.default ? [step.default] : []),
      ]),
    ];
    const { chosen, notTaken, data } = branch.decision;
    if (
      !targets.includes(chosen) ||
      JSON.stringify(notTaken) !== JSON.stringify(targets.filter((target) => target !== chosen))
    ) return false;
    if (targets.some((target) => !flow.steps.find((candidate) => candidate.id === target)?.dependsOn.includes(id))) {
      return false;
    }
    if (branch.inputIds.some((inputId) => inputId === id || !results.has(inputId))) return false;
    if (branch.fingerprint !== await this.branchFingerprint(flow, step, request, results, branch)) return false;
    const completed = results.get(id);
    if (completed && (completed.skipped || completed.result?.content !== branch.result.content)) return false;
    try {
      return JSON.stringify(parseBranchOutput(branch.result.content)) === JSON.stringify(data);
    } catch {
      return false;
    }
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
