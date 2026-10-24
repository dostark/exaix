/**
 * @module VerificationDocsTest
 * @path tests/scripts/verification_docs_test.ts
 * @related-files []
 * @architectural-layer Test
 * @description Doc-content assertions for the post-execution verification feature.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas";

const ROOT = new URL("../..", import.meta.url).pathname;

/** Every fenced TOML block in a Markdown document, in document order. */
function fencedTomlBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => match[1]);
}

Deno.test("User Guide both-kind verification example parses through ConfigSchema", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  const block = fencedTomlBlocks(guide).find((candidate) =>
    candidate.includes('kind = "unslop"') && candidate.includes('kind = "deno_task"')
  );
  assert(block, "the guide must carry one example with both check kinds");

  // The guide shows the portal fragment of exa.config.toml, so the example omits the workspace header.
  const config = ConfigSchema.parse(parseToml(`[system]\nroot = "."\n${block}`));
  const verification = config.portals[0]?.verification;
  assert(verification, "the example must configure portal verification");
  assertEquals(verification.max_repair_attempts, 2);
  assertEquals(verification.check_timeout_ms, 300_000);
  assertEquals(verification.output_max_chars, 4_000);
  assertEquals(verification.checks.length, 2);

  const unslop = verification.checks[0];
  assert(unslop.kind === "unslop");
  assertEquals(unslop.packs, ["typescript", "deno"]);
  assertEquals(unslop.catalog, "catalogs/portal.json");
  assertEquals(unslop.include, ["src/**/*.ts", "packages/**/*.tsx"]);

  const denoTask = verification.checks[1];
  assert(denoTask.kind === "deno_task");
  assertEquals(denoTask.task, "test");
  assertEquals(denoTask.path, ".");
  assertEquals(denoTask.args, ["--allow-read=src"]);
});

Deno.test("User Guide documents the unslop policy, defaults and failure classes", async () => {
  const guide = await Deno.readTextFile(join(ROOT, "docs", "Exaix_User_Guide.md"));
  for (
    const token of [
      'packs = ["typescript", "deno"]',
      "**/*.mts",
      "**/*.cts",
      "deno-lint-ignore",
      "UnslopSuppressionForbidden",
      "UnslopCatalogInvalid",
      "verification.unslop.findings_limit",
      "findings count incomplete",
    ]
  ) {
    assertStringIncludes(guide, token);
  }
});

Deno.test("both lint READMEs agree on packaging, provenance and redeploy", async () => {
  const policyReadme = await Deno.readTextFile(join(ROOT, "packages", "lint-policy", "README.md"));
  const engineReadme = await Deno.readTextFile(join(ROOT, "unslop-ts", "README.md"));
  assertStringIncludes(policyReadme, "unslop-ts:bundle");
  for (const readme of [policyReadme, engineReadme]) {
    for (const token of ["unslop_engine.js", "manifest.json", "checksum", "redeploy", "offline"]) {
      assertStringIncludes(readme, token);
    }
  }
});

Deno.test("ARCHITECTURE describes the terminal unslop snapshot and review join", async () => {
  const architecture = await Deno.readTextFile(join(ROOT, "ARCHITECTURE.md"));
  for (
    const token of [
      "execution.verification.lint_findings",
      "verification_run_id",
      "UnslopCheckRunner",
      "formatUnslopSummary",
    ]
  ) {
    assertStringIncludes(architecture, token);
  }
});

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
      "execution.verification.lint_check.started",
      "execution.verification.lint_check.completed",
      "execution.verification.lint_findings",
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
