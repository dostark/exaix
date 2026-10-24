/**
 * @module ReviewUnslopSecurityTest
 * @path apps/exactl/tests/review_unslop_security_test.ts
 * @description The review unslop projection and summary never re-enable terminal control
 *   sequences, and Unicode display stays intact.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/review_commands.ts]
 * @related-files [apps/exactl/src/commands/review_commands.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { formatUnslopSummary, isDisplaySafeText } from "../src/commands/review_commands.ts";

Deno.test("[security] the review projection rejects raw terminal controls", () => {
  assertEquals(isDisplaySafeText("src/seed.ts"), true);
  assertEquals(isDisplaySafeText("uni-é.ts"), true);
  assertEquals(isDisplaySafeText("bad\u0007name.ts"), false);
  assertEquals(isDisplaySafeText("line\nbreak.ts"), false);
  assertEquals(isDisplaySafeText("esc\u001b[31m.ts"), false);
});

Deno.test("[security] the summary preserves escaped paths without control characters", () => {
  const lines = formatUnslopSummary({
    total: 1,
    findings: [{ file: "secret-token-abc.ts", line: 1, rule: "unslop/no-explicit-unknown" }],
    truncated: false,
    checks: [{ check_index: 0, outcome: "failed", total: 1, error_class: null }],
  });
  for (const line of lines) {
    assert(
      ![...line].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      }),
    );
  }
  assertEquals(lines[1], "  secret-token-abc.ts:1 unslop/no-explicit-unknown");
});
