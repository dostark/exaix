/**
 * @module RequestCancel
 * @path packages/core/src/request/request_cancel.ts
 * @description Shared constants and result type of request cancellation.
 * @architectural-layer Core
 * @related-files [packages/request/src/service.ts, packages/core/src/errors/request_cancel_errors.ts]
 */

import type { RequestStatusType } from "../status/request_status.ts";

/** The outcome of cancelling a request. */
export interface IRequestCancelResult {
  trace_id: string;
  filename: string;
  previous_status: RequestStatusType;
  status: "cancelled";
}

/** Shortest trace id prefix that identifies a request for cancellation. */
export const MIN_REQUEST_ID_PREFIX_CHARS = 8;
