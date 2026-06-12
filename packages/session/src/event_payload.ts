/**
 * @module SessionDelegateEventPayload
 * @path packages/session/src/event_payload.ts
 * @description Phase 106 Step 9 — GAP-12 typed payload for the session.delegate.*
 *   EventLogger family. Every field is JSONValue-assignable and the index
 *   signature keeps it assignable to ILogEvent.payload (Record<string, JSONValue>),
 *   so journaling stays auditable without an untyped `Record`.
 * @architectural-layer Services
 * @dependencies [@exaix/core]
 * @related-files [apps/daemon/src/session_return_watcher.ts, packages/core/src/events/domain_event_types.ts]
 */

import type { JSONValue } from "@exaix/core/types";

/** Typed payload for a session.delegate.* event (all fields optional, JSON-safe). */
export interface ISessionDelegateEventPayload {
  accepted?: boolean;
  decision?: string | null;
  rejected?: boolean;
  reason?: string | null;
  violation_count?: number;
  budget_exceeded?: boolean;
  /** JSONValue index keeps the payload assignable to ILogEvent.payload. */
  [key: string]: JSONValue | undefined;
}
