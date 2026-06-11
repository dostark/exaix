/**
 * @module ISessionWaitStore
 * @path packages/session/src/wait/i_session_wait_store.ts
 * @description Interface for the session-delegation wait store (GAP-1 shim).
 *   Tracks pending/resumed/expired/cancelled delegation wait states. Designed to
 *   be re-pointed at WaitStateService when Phase 84 lands, with no call-site change.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/wait/session_wait_store.ts, packages/schemas/src/session_delegate.ts]
 */

import type { SessionDecision, SessionGate, SessionWaitState } from "@exaix/schemas/session_delegate.ts";

export interface ISessionWaitStore {
  /** Park a gate as awaiting_session_delegate. Returns the stored wait state. */
  park(traceId: string, gate: SessionGate, resumeToken: string, deadline: string): Promise<SessionWaitState>;
  /** Resume a pending wait state. Rejects on bad token, non-pending status, or past deadline. */
  resume(traceId: string, resumeToken: string, decision: SessionDecision): Promise<SessionWaitState>;
  /** Mark a wait state expired (called by the deadline watcher). */
  expire(traceId: string): Promise<SessionWaitState>;
  /** Cancel a wait state (human abort). */
  cancel(traceId: string): Promise<SessionWaitState>;
  /** Load a wait state by traceId; returns undefined if not found. */
  get(traceId: string): Promise<SessionWaitState | undefined>;
}
