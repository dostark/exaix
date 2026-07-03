/**
 * @module SelfImprovementProcessTest
 * @path tests/agents/self_improvement_process_test.ts
 * @description Verifies the agent's self-improvement lifecycle, ensuring that
 * process templates and quality metrics follow the declared technical standards.
 */

import { assert, assertExists } from "@std/assert";
import {
  assertChunksWereGenerated,
  assertFilesExist,
  assertFrontmatterSchemaAndShortSummary,
} from "../helpers/copilot_assertions.ts";

const REQUIRED_FILES = [
  ".copilot/skills/self-improvement/SKILL.md",
  ".copilot/cross-reference.md",
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

Deno.test("Self-improvement loop: verify discovery docs mention the process", async () => {
  const crossRef = await Deno.readTextFile(".copilot/cross-reference.md");
  assert(
    crossRef.includes("Self-Improvement Loop") ||
      crossRef.includes("self-improvement"),
    "cross-reference should include self-improvement reference",
  );
  assert(
    crossRef.includes("skills/self-improvement"),
    "cross-reference should link to self-improvement skill",
  );

  const commandsReadme = await Deno.readTextFile(".copilot/prompts/README.md");
  assert(
    commandsReadme.includes("#commit") || commandsReadme.includes("commit"),
    "prompts README should reference the commit workflow",
  );
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
  assert(Array.isArray(processDoc.chunks), "self-improvement.md should have chunks array");
  assert(processDoc.chunks.length > 0, "self-improvement.md should have at least 1 chunk");
});

Deno.test("Self-improvement loop: verify chunks were generated", async () => {
  const patterns = [
    "self-improvement.md.chunk",
  ];

  await assertChunksWereGenerated(patterns);
});
