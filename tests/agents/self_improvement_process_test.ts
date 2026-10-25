/**
 * @module SelfImprovementProcessTest
 * @path tests/agents/self_improvement_process_test.ts
 * @description Verifies the agent's self-improvement lifecycle, ensuring that
 * process templates and quality metrics follow the declared technical standards.
 */

import { assert, assertExists } from "@std/assert";
import { assertFilesExist, assertFrontmatterSchemaAndShortSummary } from "../helpers/copilot_assertions.ts";

const REQUIRED_FILES = [
  ".copilot/skills/self-improvement/SKILL.md",
  ".copilot/manifest.json",
  ".copilot/prompts/README.md",
];

Deno.test("Self-improvement loop: verify required files exist", async () => {
  await assertFilesExist(REQUIRED_FILES);
});

Deno.test("Self-improvement loop: verify process doc has required sections", async () => {
  const processMd = await Deno.readTextFile(".copilot/skills/self-improvement/SKILL.md");
  assert(processMd.includes("Key points"), "process doc should have Key points");
  assert(processMd.includes("Canonical prompt (short)"), "process doc should have Canonical prompt (short)");
  assert(processMd.includes("Examples"), "process doc should have Examples");
  assert(
    processMd.includes("Do / Don") || processMd.includes("Do/Don"),
    "process doc should have Do / Don't section",
  );
});

Deno.test("Self-improvement loop: verify frontmatter schema + short_summary limits", async () => {
  const files = [
    ".copilot/skills/self-improvement/SKILL.md",
  ];

  await assertFrontmatterSchemaAndShortSummary(files);
});

Deno.test("Self-improvement loop: verify manifest includes self-improvement doc", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  assert(Array.isArray(manifest.docs), "Manifest should have docs array");

  const paths = manifest.docs.map((d: { path: string }) => d.path);
  assert(
    paths.includes(".copilot/skills/self-improvement/SKILL.md"),
    "Manifest should include self-improvement skill",
  );

  const processDoc = manifest.docs.find((d: { path: string }) =>
    d.path === ".copilot/skills/self-improvement/SKILL.md"
  );
  assertExists(processDoc, "self-improvement.md should be in manifest");
});

Deno.test("Self-improvement loop: terminal retro reconciles the phase registry", async () => {
  const processMd = await Deno.readTextFile(".copilot/skills/self-improvement/SKILL.md");

  assert(processMd.includes("Reconcile `exaix-dev-docs/planning/PHASE_REGISTRY.md`"));
  assert(processMd.includes("remove a completed phase from open/recommended-pickup rows"));
  assert(processMd.includes("search the registry for stale occurrences"));
});

Deno.test("Self-improvement loop: routes domain-specific findings to domain docs, not general skills", async () => {
  // Pin the classify-first routing rule: this skill must teach that phase/domain-specific
  // detail goes to the owning domain doc, not into a general skill every phase re-reads.
  const processMd = await Deno.readTextFile(".copilot/skills/self-improvement/SKILL.md");

  assert(
    processMd.includes("Classify the finding FIRST"),
    "routing step must teach classify-the-finding-first",
  );
  assert(
    processMd.includes("does NOT belong in a general skill"),
    "routing step must forbid phase/domain-specific detail in general skills",
  );
  assert(
    processMd.includes("tests/scenario_framework/README.md"),
    "routing step must name the owning domain doc as the correct home",
  );
});

Deno.test("phase-registry-current: completed and superseded phases have no open rows", async () => {
  const [phase233, phase229] = await Promise.all([
    Deno.readTextFile("exaix-dev-docs/planning/phase-233-lean-portal-lint-verification.md"),
    Deno.readTextFile("exaix-dev-docs/planning/phase-229-portal-unslop-verification.md"),
  ]);
  assert(/^status: COMPLETED$/m.test(phase233), "Phase 233 must be COMPLETED");
  assert(/^status: SUPERSEDED$/m.test(phase229), "Phase 229 must be SUPERSEDED");
  const lines = (await Deno.readTextFile("exaix-dev-docs/planning/PHASE_REGISTRY.md")).split("\n");
  for (const phase of [229, 233]) {
    assert(
      !lines.some((line) => new RegExp(`^\\|\\s*\\d+\\s*\\|\\s*${phase}\\s*\\|`).test(line)),
      `Phase ${phase} must leave the open-work registry`,
    );
  }
});

Deno.test("process-guards: the review-remediation-retro guardrails stay pinned", async () => {
  const [review, remediate, retro, nextSteps, commit] = await Promise.all([
    Deno.readTextFile(".copilot/skills/review-phase-code/SKILL.md"),
    Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md"),
    Deno.readTextFile(".copilot/skills/self-improvement/SKILL.md"),
    Deno.readTextFile(".copilot/skills/next-steps/SKILL.md"),
    Deno.readTextFile(".copilot/skills/commit/SKILL.md"),
  ]);
  assert(review.includes("ci.ts check` does not execute tests"), "the review must run planned tests");
  assert(remediate.includes("git branch --show-current"), "remediation must check the branch");
  assert(remediate.includes("deno fmt` reflowed"), "remediation must re-read formatted blocks");
  assert(retro.includes("retro written before the review"), "the retro must follow the review");
  assert(nextSteps.includes("git branch --show-current"), "plan-step commits must check the branch");
  assert(commit.includes("Pre-commit the plan submodule"), "the commit skill must keep the submodule staged");
});
