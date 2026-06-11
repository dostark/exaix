/**
 * @module ConstantTime
 * @path packages/session/src/constant_time.ts
 * @description Constant-time string comparison shared by resume-token validation
 *   in reconcile() and the wait store (GAP-2). No early-out on first mismatch.
 * @architectural-layer Services
 * @related-files [packages/session/src/reconcile.ts, packages/session/src/wait/session_wait_store.ts]
 */

/** Compare two strings without short-circuiting on the first differing char. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
