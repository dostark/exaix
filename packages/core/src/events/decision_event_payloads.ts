/**
 * @module DecisionEventPayloads
 * @path packages/core/src/events/decision_event_payloads.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/events/domain_event_types.ts"]
 * @description Typed payloads of the events that record a human decision on a request or a tool confirmation:
 * request.cancelled and tool_confirmation.decided.
 */

/** Typed payload for tool_confirmation.decided. `reason` is set on a denial only. */
export interface IToolConfirmationDecidedPayload {
  confirmation_id: string;
  tool_name: string;
  step_id: string | null;
  approved: boolean;
  reason: string | null;
  decided_by: string;
}

/** Typed payload for request.cancelled. `request_id` is the request trace id. */
export interface IRequestCancelledPayload {
  request_id: string;
  previous_status: string;
  reason: string | null;
  cancelled_by: string;
}
