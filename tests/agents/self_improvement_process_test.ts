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
