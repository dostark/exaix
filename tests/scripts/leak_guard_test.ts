/**
 * @module LeakGuardTest
 * @path tests/scripts/leak_guard_test.ts
 * @description Regression tests for scripts/leak_guard.ts against a submodule-backed
 *   exaix-team/ tree (Phase 171 Step 7) — in particular that an uninitialized
 *   submodule (an empty gitlink directory, as seen by a contributor who has not yet run
 *   `git submodule update --init`) does not crash the scan.
 * @architectural-layer Test
 * @related-files [scripts/leak_guard.ts]
 */

import { assertEquals } from "@std/assert";
import { runLeakGuard } from "../../scripts/leak_guard.ts";

Deno.test("[leak-guard] an uninitialized (empty) submodule directory does not throw and reports zero errors", async () => {
  const emptyDir = await Deno.makeTempDir({ prefix: "leak_guard_uninit_submodule_" });
  try {
    const result = await runLeakGuard({ allowlist: [emptyDir] });
    assertEquals(result.passed, true);
    assertEquals(result.errors, []);
  } finally {
    await Deno.remove(emptyDir, { recursive: true });
  }
});

Deno.test("[leak-guard] the real exaix-team submodule tree scans clean", async () => {
  const result = await runLeakGuard({ allowlist: ["exaix-team"] });
  assertEquals(result.passed, true);
  assertEquals(result.errors, []);
});

Deno.test("[leak-guard] a gitignored .duplication_report* artifact directory is not scanned", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "leak_guard_dup_report_" });
  try {
    const reportDir = `${tempDir}/.duplication_report_integration_tests`;
    await Deno.mkdir(reportDir);
    // jscpd's report embeds duplicated source verbatim, so a fixture quoting an
    // exaix-team/ path on one JSON line looks like a real source leak to the line-based
    // scan below — built via concatenation so this file's own source doesn't trip it too.
    const teamDir = "exaix" + "-team";
    await Deno.writeTextFile(
      `${reportDir}/jscpd-report.json`,
      JSON.stringify({
        duplicates: [{
          fragment: `import { resolve } from "@std/path";\nconst X = resolve("${teamDir}", "apps");`,
        }],
      }),
    );

    const result = await runLeakGuard({ allowlist: [tempDir] });
    assertEquals(result.passed, true);
    assertEquals(result.errors, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
