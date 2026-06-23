/**
 * @module NetPolicyTest
 * @path packages/core/tests/net_policy_test.ts
 * @description Verifies evaluateNetPolicy (Phase 124 full-alignment): the daemon's
 *   self-enforcement check that compares the net access actually granted to the
 *   process against the configured allow_net policy, so allow_net is honoured
 *   regardless of how the daemon was launched (direct run, compiled binary, or
 *   launcher). The dangerous case — config says "block all" (allow_net=[]) but the
 *   process holds blanket net — must be flagged as a violation.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/security/net_policy.ts"]
 */

import { assertEquals } from "@std/assert";
import { evaluateNetPolicy } from "@exaix/core/security";

Deno.test("[net_policy] allow_net=[] (block) + process HAS net → violation", () => {
  const result = evaluateNetPolicy({ allowNet: [], grantedNet: true });
  assertEquals(result.violated, true);
});

Deno.test("[net_policy] allow_net=[] (block) + process has NO net → compliant", () => {
  const result = evaluateNetPolicy({ allowNet: [], grantedNet: false });
  assertEquals(result.violated, false);
});

Deno.test("[net_policy] allow_net=undefined (default hosts) + process has net → compliant", () => {
  // A host allowlist cannot be verified at the process level (Deno only reports
  // blanket net), so a non-block policy is treated as compliant — enforcement of
  // specific hosts remains the launcher's --allow-net flag.
  const result = evaluateNetPolicy({ allowNet: undefined, grantedNet: true });
  assertEquals(result.violated, false);
});

Deno.test("[net_policy] allow_net=['host'] (narrow) + process has net → compliant (host enforcement is OS-level)", () => {
  const result = evaluateNetPolicy({ allowNet: ["api.anthropic.com"], grantedNet: true });
  assertEquals(result.violated, false);
});

Deno.test("[net_policy] violation carries a human-readable reason", () => {
  const result = evaluateNetPolicy({ allowNet: [], grantedNet: true });
  assertEquals(typeof result.reason, "string");
  assertEquals(result.reason!.length > 0, true);
});
