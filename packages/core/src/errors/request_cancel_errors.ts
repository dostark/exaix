/**
 * @module RequestCancelErrors
 * @path packages/core/src/errors/request_cancel_errors.ts
 * @description Typed errors of request cancellation: a refused status, a bad id and an unknown request.
 * @architectural-layer Errors
 * @related-files [packages/request/src/service.ts, apps/exactl/src/command_builders/request_actions.ts]
 */

import { RequestStatus, type RequestStatusType } from "../status/request_status.ts";

const IN_FLIGHT_STATUSES: readonly RequestStatusType[] = [
  RequestStatus.ANALYZING,
  RequestStatus.ENRICHING,
  RequestStatus.REFINING,
  RequestStatus.IN_PROGRESS,
];

/** The sentence that tells the user what to do instead of cancelling a request in this status. */
function alternativeFor(requestId: string, status: RequestStatusType): string {
  if (status === RequestStatus.PLANNED) {
    return `Request ${requestId} is planned. Reject its plan with 'exactl plan reject <plan-id>' instead.`;
  }
  if (IN_FLIGHT_STATUSES.includes(status)) {
    return `Request ${requestId} is ${status} and in flight. Retry when it settles.`;
  }
  return `Request ${requestId} is already ${status}.`;
}

/** The request is in a status that cancellation does not accept. */
export class RequestCancelNotAllowedError extends Error {
  constructor(readonly requestId: string, readonly status: RequestStatusType) {
    super(alternativeFor(requestId, status));
    this.name = "RequestCancelNotAllowedError";
  }
}

/** The request id is empty, too short for a prefix match or matches more than one request. */
export class RequestIdError extends Error {
  constructor(message: string, readonly matches: readonly string[]) {
    super(message);
    this.name = "RequestIdError";
  }
}

/** No request matches the id. */
export class RequestNotFoundError extends Error {
  constructor(readonly requestId: string) {
    super(`Request not found: ${requestId}`);
    this.name = "RequestNotFoundError";
  }
}

/** The request file has no status that is a request status, so no cancel rule applies to it. */
export class RequestStatusInvalidError extends Error {
  constructor(readonly requestId: string) {
    super(`Request ${requestId} has no valid status.`);
    this.name = "RequestStatusInvalidError";
  }
}
