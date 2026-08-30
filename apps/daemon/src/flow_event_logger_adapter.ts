/**
 * @module FlowEventLoggerAdapter
 * @path apps/daemon/src/flow_event_logger_adapter.ts
 * @description Adapts the daemon's IEventLogger into FlowRunner's narrower
 *   IFlowEventLogger interface. Extracted from apps/daemon/main.ts (Phase 167 Step 3)
 *   after a live trace_scoped journal-assert against flow.step.started returned zero
 *   rows despite the event firing: the persisted row's trace_id column held a random
 *   UUID instead of the request's real trace. Root cause -- the previous inline
 *   adapter called `logger.info(event, "flow-runner", payload)` without the explicit
 *   4th `traceId` argument, so EventLogger.log() fell back to `crypto.randomUUID()`
 *   for every flow-lifecycle event (flow.step.started, flow.validated,
 *   flow.wave.started, ...), even though most of those payloads already carry a
 *   correct `traceId` field for display purposes. This adapter forwards that payload
 *   field through as the logger call's own traceId argument, so the journal row's
 *   trace_id column matches the request's real trace and `trace_scoped: true`
 *   journal-assert steps can actually find flow-runner events.
 * @architectural-layer Application
 * @dependencies [@exaix/core, @exaix/flow]
 * @related-files [apps/daemon/main.ts, packages/flow/src/flow_runner.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import type { IFlowEventLogger, IFlowEventPayload } from "@exaix/flow";

/** Structural subset of a flow event payload that may carry the request's trace id. */
interface IFlowEventPayloadWithTraceId {
  traceId?: string;
}

/** Wraps the daemon's IEventLogger (which writes to the activity journal) as an IFlowEventLogger. */
export function createFlowEventLogger(logger: IEventLogger): IFlowEventLogger {
  return {
    log: <TEvent extends string>(
      event: TEvent,
      payload: IFlowEventPayload<TEvent>,
    ): void => {
      const traceId = (payload as IFlowEventPayloadWithTraceId).traceId;
      logger.info(
        event,
        "flow-runner",
        payload as Record<string, string | number | boolean | null | undefined>,
        traceId,
      );
    },
  };
}
