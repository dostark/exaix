/**
 * @module Phase208VerificationDocsTest
 * @path tests/scripts/phase208_verification_docs_test.ts
 * @related-files []
 * @architectural-layer Test
 * @description Doc-content assertions for the Phase 208 post-execution verification feature.
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const ROOT = new URL("../..", import.meta.url).pathname;

Deno.test("User Guide documents portals[].verification", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  for (
    const token of [
      "portals[].verification",
      "verification_status",
      "not_configured",
      "repaired",
      "max_repair_attempts",
      "check_timeout_ms",
      "output_max_chars",
    ]
  ) {
    assertStringIncludes(guide, token);
  }
});

Deno.test("User Guide distinguishes portals[].verification from exactl portal verify", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  assertStringIncludes(guide, "unrelated to `exactl portal verify`");
  assertStringIncludes(guide, "updatePortalVerification");
});

Deno.test("ARCHITECTURE and the event taxonomy describe the verification stage", async () => {
  const architecture = await Deno.readTextFile(join(ROOT, "ARCHITECTURE.md"));
  assertStringIncludes(architecture, "verification_status");

  const reference = await Deno.readTextFile(join(ROOT, "docs", "Reference_Data.md"));
  for (
    const event of [
      "execution.verification.started",
      "execution.verification.passed",
      "execution.verification.failed",
      "execution.verification.exhausted",
      "execution.repair.started",
      "execution.repair.completed",
    ]
  ) {
    assertStringIncludes(reference, event);
  }
});

Deno.test("User Guide documents the scoped-only verification arg rule", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  for (const token of ["--allow-<name>=<values>", "--permission-set", "short permission flags", "bounded in memory"]) {
    assertStringIncludes(guide, token);
  }
});

Deno.test("User Guide documents verification_status in exactl review show", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  assertStringIncludes(guide, "`exactl review show` prints `verification_status`");
});

Deno.test("Reference_Data documents the repair phase on trace-scoped plan.execution events", async () => {
  const reference = await Deno.readTextFile(join(ROOT, "docs", "Reference_Data.md"));
  assertStringIncludes(reference, 'phase: "repair"');
  assertStringIncludes(reference, "on the request trace");
});
