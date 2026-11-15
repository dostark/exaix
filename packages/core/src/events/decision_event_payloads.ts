/**
 * @module DecisionEventPayloads
 * @path packages/core/src/events/decision_event_payloads.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/events/domain_event_types.ts"]
 * @description Typed payloads of the events that record a human decision: request.cancelled,
 * tool_confirmation.decided and cli.confirmation_resolved.
 */

import type { CliConfirmationMode, CliConfirmationOutcome } from "../types/enums.ts";

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

/** Typed payload for cli.confirmation_resolved. It records how an exactl verb got consent. */
export interface ICliConfirmationPayload {
  verb: string;
  mode: CliConfirmationMode;
  outcome: CliConfirmationOutcome;
}
