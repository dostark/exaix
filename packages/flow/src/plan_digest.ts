/**
 * @module PlanDigest
 * @path packages/flow/src/plan_digest.ts
 * @description Phase 174 Step 4 package-pure sha256 digest of a resolved PlanContext
 *   document's raw text, used as the cycle checkpoint/claim identifying component that
 *   detects an operator editing the hardened phase plan mid-cycle.
 * @architectural-layer Flows
 * @dependencies []
 * @related-files [packages/session/src/session_delegate_cycle_store.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

/** sha256 hex digest of `content`, matching `/^[a-f0-9]{64}$/`. */
export async function computePlanDigest(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
    .join("");
}
