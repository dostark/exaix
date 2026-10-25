/**
 * @module ReviewLintCliTest
 * @path apps/exactl/tests/review_lint_cli_test.ts
 * @description The review-show lint summary lines: exact totals, capped entries, truncation,
 *   incomplete coverage and repaired state.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/review_commands.ts]
 * @related-files [apps/exactl/src/commands/review_commands.ts, apps/exactl/src/exactl.ts]
 */

import { createReviewJournalFixture } from "./helpers/review_journal_fixture.ts";
import { LintErrorClass } from "@exaix/schemas";
import { assert, assertEquals } from "@std/assert";
import { formatLintSummary, type IReviewLintSummary } from "../src/commands/review_commands.ts";

const capOne: IReviewLintSummary = {
  total: 2,
  findings: [{ file: "src/seed.ts", line: 3, rule: "unslop/no-chained-type-assertions" }],
  truncated: true,
  checks: [{ check_index: 0, outcome: "failed", total: 2, error_class: null }],
};

Deno.test("review-lint-cli-output", () => {
  assertEquals(formatLintSummary(capOne), [
    "lint: 2 remaining finding(s)",
    "  src/seed.ts:3 unslop/no-chained-type-assertions",
    "  (1 more not listed)",
  ]);

  assertEquals(
    formatLintSummary({ ...capOne, total: null, truncated: false }),
    ["lint: findings count incomplete", "  src/seed.ts:3 unslop/no-chained-type-assertions"],
  );

  assertEquals(
    formatLintSummary({
      ...capOne,
      total: null,
      truncated: false,
      checks: [{ check_index: 1, outcome: "not_run", total: null, error_class: null }],
    }),
    [
      "lint: findings count incomplete",
      "  src/seed.ts:3 unslop/no-chained-type-assertions",
      "  (coverage incomplete)",
    ],
  );

  assertEquals(
    formatLintSummary({ total: 0, findings: [], truncated: false, checks: [] }),
    ["lint: no findings remain"],
  );
  assertEquals(
    formatLintSummary({ total: null, findings: [], truncated: false, checks: [], unavailable: true }),
    ["lint: lint details unavailable"],
  );
});

Deno.test("real-cli-cap-error-security / actual-cli-error-notes", async () => {
  const fixture = await createReviewJournalFixture();
  try {
    await fixture.log();
    const capped = await fixture.cli();
    assert(capped.includes("lint: 2 remaining finding(s)"), capped);
    assert(capped.includes("(1 more not listed)"), capped);
    for (const errorClass of Object.values(LintErrorClass)) {
      await fixture.log({
        total: null,
        findings: [],
        truncated: false,
        checks: [{ check_index: 0, outcome: "error", total: null, error_class: errorClass }],
      }, "error");
      const output = await fixture.cli();
      assert(output.includes(errorClass), output);
      assert(output.includes("coverage incomplete"), output);
      assert(output.includes("verification could not complete; check the policy and source"), output);
      assert(output.includes("verification error"), output);
    }
  } finally {
    await fixture.cleanup();
  }
});
