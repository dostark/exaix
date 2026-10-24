/**
 * @module ReviewUnslopCliTest
 * @path apps/exactl/tests/review_unslop_cli_test.ts
 * @description The review-show unslop summary lines: exact totals, capped entries, truncation,
 *   incomplete coverage and repaired state.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/review_commands.ts]
 * @related-files [apps/exactl/src/commands/review_commands.ts, apps/exactl/src/exactl.ts]
 */

import { assertEquals } from "@std/assert";
import { formatUnslopSummary, type IReviewUnslopSummary } from "../src/commands/review_commands.ts";

const capOne: IReviewUnslopSummary = {
  total: 2,
  findings: [{ file: "src/seed.ts", line: 3, rule: "unslop/no-chained-type-assertions" }],
  truncated: true,
  checks: [{ check_index: 0, outcome: "failed", total: 2, error_class: null }],
};

Deno.test("review-unslop-cli-output", () => {
  assertEquals(formatUnslopSummary(capOne), [
    "unslop: 2 remaining finding(s)",
    "  src/seed.ts:3 unslop/no-chained-type-assertions",
    "  (1 more not listed)",
  ]);

  assertEquals(
    formatUnslopSummary({ ...capOne, total: null, truncated: false }),
    ["unslop: findings count incomplete", "  src/seed.ts:3 unslop/no-chained-type-assertions"],
  );

  assertEquals(
    formatUnslopSummary({
      ...capOne,
      total: null,
      truncated: false,
      checks: [{ check_index: 1, outcome: "not_run", total: null, error_class: null }],
    }),
    [
      "unslop: findings count incomplete",
      "  src/seed.ts:3 unslop/no-chained-type-assertions",
      "  (coverage incomplete)",
    ],
  );

  assertEquals(
    formatUnslopSummary({ total: 0, findings: [], truncated: false, checks: [] }),
    ["unslop: no findings remain"],
  );
  assertEquals(
    formatUnslopSummary({ total: null, findings: [], truncated: false, checks: [], unavailable: true }),
    ["unslop: lint details unavailable"],
  );
});
