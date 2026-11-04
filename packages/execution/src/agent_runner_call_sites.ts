/**
 * @module CallSiteCounter
 * @path packages/execution/src/agent_runner_call_sites.ts
 * @description Assigns the call site of each logical model call and advances its call index once the response is consumed.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/tests/agents/call_index_semantics_test.ts]
 */

import type { ICallSite } from "@exaix/ai/types.ts";
import type { IRecordingLane, Opt, Reason } from "@exaix/core/types";
import type { IParsedRequest } from "./agent_runner.ts";

/** Remembers which run lane issued each explicit call site until its response is consumed. */
class LaneCallSites {
  readonly #lanes = new WeakMap<ICallSite, IRecordingLane>();

  track(callSite: ICallSite, lane: IRecordingLane): ICallSite {
    this.#lanes.set(callSite, lane);
    return callSite;
  }

  /** Advances the issuing lane. Returns false for a call site that the shared counter owns. */
  consume(callSite: ICallSite): boolean {
    const lane = this.#lanes.get(callSite);
    if (!lane) return false;
    lane.consume(callSite);
    this.#lanes.delete(callSite);
    return true;
  }
}

/** Assigns and advances the call index that addresses each recorded model call by scenario and step. */
export class CallSiteCounter {
  /** Next call index per (scenarioId, stepId, flowStepId), for fixture replay addressing.
   *  Incremented once per consumed response — a retried logical call keeps its index. */
  private readonly nextIndexByKey = new Map<string, number>();
  /** Explicit run-lane call sites awaiting consumption. They never touch the shared counter. */
  private readonly lanes = new LaneCallSites();

  /** Reads the next call index for the call. The flow step id scopes the counter. */
  resolve(request: IParsedRequest): ICallSite | undefined {
    if (request.recordingLane) return this.lanes.track(request.recordingLane.current(), request.recordingLane);
    if (!request.scenarioId || !request.stepId) return undefined;
    const key = this.counterKey(request.scenarioId, request.stepId, request.flowStepId);
    const callIndex = this.nextIndexByKey.get(key) ?? 0;
    return {
      scenarioId: request.scenarioId,
      stepId: request.stepId,
      // Omitted for non-flow calls, so their call site keeps its earlier shape.
      ...(request.flowStepId ? { flowStepId: request.flowStepId } : {}),
      callIndex,
    };
  }

  /** Advances the call index once the response is consumed. Retries reuse the call site, so only the next run sees it. */
  consume(callSite: Opt<ICallSite, Reason.OptionalContext>): void {
    if (!callSite) return;
    if (this.lanes.consume(callSite)) return;
    const key = this.counterKey(callSite.scenarioId, callSite.stepId, callSite.flowStepId);
    this.nextIndexByKey.set(key, callSite.callIndex + 1);
  }

  /** Builds the counter key. Both `resolve` and `consume` must use it. */
  private counterKey(
    scenarioId: string,
    stepId: string,
    flowStepId: Opt<string, Reason.OptionalContext>,
  ): string {
    return `${scenarioId}::${stepId}::${flowStepId ?? ""}`;
  }
}
