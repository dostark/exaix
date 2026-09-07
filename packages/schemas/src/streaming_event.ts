/**
 * @module StreamingEventSchema
 * @path packages/schemas/src/streaming_event.ts
 * @description Zod validation schema for live execution streaming events.
 * @architectural-layer Schemas
 * @ungrounded
 * @dependencies [src/shared/constants.ts]
 * @related-files [packages/core/src/observability/event_bus_service.ts, exaix-team/packages/mcp-server/sse_handler.ts]
 */

import { z } from "zod";
import {
  STREAMING_EVENT_FLOW_STATUS,
  STREAMING_EVENT_HEARTBEAT,
  STREAMING_EVENT_LLM_STREAM,
  STREAMING_EVENT_MILESTONE,
  STREAMING_EVENT_TOOL_END,
  STREAMING_EVENT_TOOL_START,
} from "@exaix/core";

/** Used by the EventBusService and SSE handler for type safety. */
export const ZStreamingEvent = z.object({
  eventId: z.string().uuid(),
  traceId: z.string(),
  timestamp: z.string().datetime(),
  type: z.enum(
    [
      STREAMING_EVENT_HEARTBEAT,
      STREAMING_EVENT_MILESTONE,
      STREAMING_EVENT_TOOL_START,
      STREAMING_EVENT_TOOL_END,
      STREAMING_EVENT_LLM_STREAM,
      STREAMING_EVENT_FLOW_STATUS,
    ] as const,
  ),
  payload: z.record(z.string(), z.unknown()),
});

export type IStreamingEvent = z.infer<typeof ZStreamingEvent>;

/** Type-cast the payload to this when type === STREAMING_EVENT_LLM_STREAM. */
export interface ITokenStreamPayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
