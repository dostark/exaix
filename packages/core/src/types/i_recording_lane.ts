/**
 * @module IRecordingLane
 * @path packages/core/src/types/i_recording_lane.ts
 * @description Structural fixture call-site lanes shared by flow, execution, AI and Team voting callers.
 * @architectural-layer Core
 * @dependencies []
 * @related-files [packages/flow/src/contracts/flow_recording_context.ts, packages/execution/src/agent_runner.ts, packages/ai/src/recording_lane_provider.ts]
 */

/** Mirrors the AI ICallSite shape so core stays independent of the provider package. */
export interface IRecordedCallSite {
  scenarioId: string;
  stepId: string;
  flowStepId?: string;
  callIndex: number;
}

/** One caller lane of a run-local allocator. */
export interface IRecordingLane {
  /** The call site of the next logical call. Repeated reads return it until it is consumed. */
  current(): IRecordedCallSite;
  /** Advances the lane after the response for `callSite` was consumed. */
  consume(callSite: IRecordedCallSite): void;
}

/** Hands out one lane per caller lane id within a single flow run. */
export interface IRecordingLaneSource {
  lane(laneId: string): IRecordingLane;
}
