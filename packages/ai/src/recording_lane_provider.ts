/**
 * @module RecordingLaneProvider
 * @path packages/ai/src/recording_lane_provider.ts
 * @description Provider decorator that keys each strategy turn by its run-local fixture recording lane.
 * @architectural-layer AI
 * @dependencies [@exaix/core/types]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/core/src/types/i_recording_lane.ts]
 */

import type { IModelOptions, IModelProvider } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import type { IRecordingLane, Opt, Reason } from "@exaix/core/types";

/** Stamps the lane's current call site on every turn and advances only after an answered turn. */
export class RecordingLaneProvider implements IModelProvider {
  public readonly id: string;
  public readonly measureInputTokens: IModelProvider["measureInputTokens"];
  public readonly callCapabilities: IModelProvider["callCapabilities"];
  public readonly estimateCallCost: IModelProvider["estimateCallCost"];

  constructor(public readonly inner: IModelProvider, private readonly lane: IRecordingLane) {
    this.id = inner.id;
    this.measureInputTokens = inner.measureInputTokens?.bind(inner);
    this.callCapabilities = inner.callCapabilities;
    this.estimateCallCost = inner.estimateCallCost?.bind(inner);
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
    const callSite = this.lane.current();
    const result = await this.inner.generate(prompt, { ...options, callSite });
    this.lane.consume(callSite);
    return result;
  }

  dispose(): Promise<void> {
    return this.inner.dispose?.() ?? Promise.resolve();
  }
}
