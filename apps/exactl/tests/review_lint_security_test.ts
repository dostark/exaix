/**
 * @module ReviewLintSecurityTest
 * @path apps/exactl/tests/review_lint_security_test.ts
 * @description The review lint projection and summary never re-enable terminal control
 *   sequences, and Unicode display stays intact.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/review_commands.ts]
 * @related-files [apps/exactl/src/commands/review_commands.ts]
 */

import { createReviewJournalFixture } from "./helpers/review_journal_fixture.ts";
import { assert, assertEquals } from "@std/assert";
import { formatLintSummary, isDisplaySafeText } from "../src/commands/review_commands.ts";

Deno.test("[security] the review projection rejects raw terminal controls", () => {
  assertEquals(isDisplaySafeText("src/seed.ts"), true);
  assertEquals(isDisplaySafeText("uni-é.ts"), true);
  assertEquals(isDisplaySafeText("bad\u0007name.ts"), false);
  assertEquals(isDisplaySafeText("line\nbreak.ts"), false);
  assertEquals(isDisplaySafeText("esc\u001b[31m.ts"), false);
});

Deno.test("[security] the summary preserves escaped paths without control characters", () => {
  const lines = formatLintSummary({
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

Deno.test("forged-journal-snapshot-rejected", async (test) => {
  const fixture = await createReviewJournalFixture();
  try {
    for (
      const [field, value] of [
        ["rule", "unslop/\u001b[31mSECRET"],
        ["rule", "<script>SECRET"],
        ["file", "bad\u0007SECRET.ts"],
        ["file", "<SECRET>.ts"],
        ["check_index", 9],
      ] as const
    ) {
      await test.step(`${field}: ${JSON.stringify(value)}`, async () => {
        await fixture.log({
          findings: [{
            check_index: 0,
            file: "src/é.ts",
            line: 3,
            rule: "unslop/no-chained-type-assertions",
            [field]: value,
          }],
        });
        const details = await fixture.show();
        assertEquals(details.lint?.unavailable, true);
        assertEquals(details.verification_status, "failed");
      });
    }
    for (
      const overrides of [{ total: 0 }, { verification_status: "passed" }, { truncated: false }, {
        checks: [{ check_index: 0, outcome: "passed", total: 2, error_class: null }],
      }]
    ) {
      await fixture.log(overrides);
      assertEquals((await fixture.show()).lint?.unavailable, true);
    }
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("malformed-row-keeps-failed-warning", async () => {
  const fixture = await createReviewJournalFixture();
  try {
    await fixture.log();
    fixture.db.logActivity(
      "daemon",
      "execution.verification.lint_findings",
      null,
      { unrelated: true },
      fixture.trace,
      null,
    );
    await fixture.db.waitForFlush();
    await fixture.db.preparedRun("UPDATE activity SET payload = ? WHERE trace_id = ? AND payload LIKE ?", [
      "{",
      fixture.trace,
      '%"unrelated":true%',
    ]);
    const details = await fixture.show();
    assertEquals(details.verification_status, "failed");
    assertEquals(details.lint?.total, 2);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("actual-cli-journal-security", async () => {
  const fixture = await createReviewJournalFixture();
  try {
    await fixture.log({ findings: [{ check_index: 0, file: "src/é.ts", line: 3, rule: "unslop/\u001b[31mSECRET" }] });
    const forged = await fixture.cli();
    assert(forged.includes("verification failed"), forged);
    assert(forged.includes("lint details unavailable"), forged);
    assertEquals(forged.includes("SECRET"), false);
    assertEquals(forged.includes("\u001b[31m"), false);
    await fixture.log();
    const normal = await fixture.cli();
    assert(normal.includes("src/é.ts:3 unslop/no-chained-type-assertions"), normal);
  } finally {
    await fixture.cleanup();
  }
});
