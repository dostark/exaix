/**
 * @module LicenseEligibilityTest
 * @path tests/scripts/license_eligibility_test.ts
 * @description Validates the LICENSE_ALLOWLIST matcher and checkLicenseEligibility
 *   function scripts/ingest_terminal_bench.ts uses to gate vendoring of externally
 *   sourced benchmark tasks (Phase 144 Step 1, GAP-10 remediation).
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { checkLicenseEligibility, LICENSE_ALLOWLIST, matchLicense } from "../../scripts/ingest_terminal_bench.ts";

const FIXTURES_DIR = new URL("./fixtures/licenses", import.meta.url).pathname;

Deno.test("[LicenseEligibility] LICENSE_ALLOWLIST contains exactly the 5 permissive licenses", () => {
  assertEquals([...LICENSE_ALLOWLIST].sort(), [
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "MIT",
  ]);
});

Deno.test("[LicenseEligibility] matchLicense identifies each allowlisted license by its canonical signature", async () => {
  const cases: Array<[string, string]> = [
    ["mit.txt", "MIT"],
    ["apache-2.0.txt", "Apache-2.0"],
    ["bsd-2-clause.txt", "BSD-2-Clause"],
    ["bsd-3-clause.txt", "BSD-3-Clause"],
    ["isc.txt", "ISC"],
  ];
  for (const [file, expected] of cases) {
    const text = await Deno.readTextFile(join(FIXTURES_DIR, file));
    assertEquals(matchLicense(text), expected, `${file} should match ${expected}`);
  }
});

Deno.test("[LicenseEligibility] matchLicense returns null for a disallowed (GPL-3.0) license", async () => {
  const text = await Deno.readTextFile(join(FIXTURES_DIR, "gpl-3.0.txt"));
  assertEquals(matchLicense(text), null);
});

Deno.test("[LicenseEligibility] checkLicenseEligibility accepts an allowlisted root license with no task-local override", async () => {
  const rootLicense = await Deno.readTextFile(join(FIXTURES_DIR, "apache-2.0.txt"));
  const result = checkLicenseEligibility(rootLicense, undefined);
  assertEquals(result.eligible, true);
  assertEquals(result.matched, "Apache-2.0");
});

Deno.test("[LicenseEligibility] checkLicenseEligibility rejects a disallowed root license", async () => {
  const rootLicense = await Deno.readTextFile(join(FIXTURES_DIR, "gpl-3.0.txt"));
  const result = checkLicenseEligibility(rootLicense, undefined);
  assertEquals(result.eligible, false);
  assertEquals(result.matched, null);
});

Deno.test("[LicenseEligibility] checkLicenseEligibility rejects a task-local license that overrides an allowlisted root", async () => {
  const rootLicense = await Deno.readTextFile(join(FIXTURES_DIR, "apache-2.0.txt"));
  const taskLocalLicense = await Deno.readTextFile(join(FIXTURES_DIR, "gpl-3.0.txt"));
  const result = checkLicenseEligibility(rootLicense, taskLocalLicense);
  assertEquals(result.eligible, false);
  assertEquals(result.reason?.includes("task-local"), true);
});
