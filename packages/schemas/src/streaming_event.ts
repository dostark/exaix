/**
 * @module StreamingEventSchema
 * @path packages/schemas/src/streaming_event.ts
 * @description Zod validation schema for live execution streaming events.
 * @architectural-layer Schemas
 * @ungrounded
 * @dependencies [src/shared/constants.ts]
 * @related-files [packages/core/src/observability/event_bus_service.ts, packages-team/mcp-server/sse_handler.ts]
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

/**
 * Schema for streaming events emitted during agent execution.
 * Used by the EventBusService and SSE handler for type safety.
 */
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
  payload: z.record(z.unknown()),
});

export type IStreamingEvent = z.infer<typeof ZStreamingEvent>;

/**
 * Typed payload interface for LLM stream events carrying token count metadata.
 * Use this to type-cast the payload when type === STREAMING_EVENT_LLM_STREAM.
 */
export interface ITokenStreamPayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
