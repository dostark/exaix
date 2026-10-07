/**
 * @module FlowRecordingContext
 * @path packages/flow/src/contracts/flow_recording_context.ts
 * @description Run-local fixture call-site allocator and the caller-specific lane names it hands out.
 * @architectural-layer Flow
 * @dependencies [@exaix/core/types]
 * @related-files [packages/core/src/types/i_recording_lane.ts, packages/flow/src/flow_runner.ts, packages/flow/src/agent_composer_adapter.ts]
 */
import type { IRecordedCallSite, IRecordingLane, IRecordingLaneSource } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";

/** The run allocator: the scenario request identity plus one lane per caller lane id. */
export interface IFlowRecordingContext extends IRecordingLaneSource {
  readonly scenarioId: string;
  readonly stepId: string;
}

export interface IFlowRecordingContextOptions {
  scenarioId?: Opt<string, Reason.OptionalContext>;
  stepId?: Opt<string, Reason.OptionalContext>;
  /** True only when the submitted request opted into recording lanes. */
  enabled: boolean;
}

const LANE_SEPARATOR = "--";

export function judgeLane(stepId: string): string {
  return `${stepId}${LANE_SEPARATOR}judge`;
}

export function reactLane(stepId: string): string {
  return `${stepId}${LANE_SEPARATOR}react`;
}

export function dynamicLane(stepId: string): string {
  return `${stepId}${LANE_SEPARATOR}dynamic`;
}

export function voterLane(stepId: string, runnerIndex: number): string {
  return `${stepId}${LANE_SEPARATOR}voter-${runnerIndex}`;
}

export function delegateReviewLane(stepId: string): string {
  return `${stepId}${LANE_SEPARATOR}delegate-review`;
}

/** A strategy lane: `react` and `mcp` steps call the provider through their own turn loop. */
export function strategyLane(stepId: string, strategy: string): string {
  return `${stepId}${LANE_SEPARATOR}${strategy}`;
}

class FlowRecordingLane implements IRecordingLane {
  #next = 0;

  constructor(private readonly site: Omit<IRecordedCallSite, "callIndex">) {}

  current(): IRecordedCallSite {
    return { ...this.site, callIndex: this.#next };
  }

  consume(callSite: IRecordedCallSite): void {
    this.#next = Math.max(this.#next, callSite.callIndex + 1);
  }
}

class FlowRecordingContext implements IFlowRecordingContext {
  readonly #lanes = new Map<string, FlowRecordingLane>();

  constructor(readonly scenarioId: string, readonly stepId: string) {}

  lane(laneId: string): IRecordingLane {
    let lane = this.#lanes.get(laneId);
    if (!lane) {
      lane = new FlowRecordingLane({ scenarioId: this.scenarioId, stepId: this.stepId, flowStepId: laneId });
      this.#lanes.set(laneId, lane);
    }
    return lane;
  }
}

/** Allocates a context only for an opted-in run that carries a scenario request identity. */
export function createFlowRecordingContext(
  options: IFlowRecordingContextOptions,
): IFlowRecordingContext | undefined {
  if (!options.enabled || !options.scenarioId || !options.stepId) return undefined;
  return new FlowRecordingContext(options.scenarioId, options.stepId);
}
