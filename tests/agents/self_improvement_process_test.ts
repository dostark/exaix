/**
 * @module SelfImprovementProcessTest
 * @path tests/agents/self_improvement_process_test.ts
 * @description Verifies the agent's self-improvement lifecycle, ensuring that
 * process templates and quality metrics follow the declared technical standards.
 */

// Unit tests to verify Step 10.8 self-improvement loop is properly implemented

import { assert, assertExists } from "@std/assert";
import {
  assertChunksWereGenerated,
  assertFilesExist,
  assertFrontmatterSchemaAndShortSummary,
} from "../helpers/copilot_assertions.ts";

const REQUIRED_FILES = [
  ".copilot/process/self-improvement.md",
  ".copilot/prompts/self-improvement-loop.md",
  ".copilot/cross-reference.md",
  ".copilot/prompts/README.md",
  ".copilot/providers/claude.md",
  ".copilot/providers/openai.md",
  ".copilot/providers/google.md",
];

Deno.test("Self-improvement loop: verify required files exist", async () => {
  await assertFilesExist(REQUIRED_FILES);
});

Deno.test("Self-improvement loop: verify process doc and template have required sections", async () => {
  const processMd = await Deno.readTextFile(".copilot/process/self-improvement.md");
  assert(processMd.includes("Key points"), "process doc should have Key points");
  assert(processMd.includes("Canonical prompt (short)"), "process doc should have Canonical prompt (short)");
  assert(processMd.includes("Examples"), "process doc should have Examples");
  assert(
    processMd.includes("Do / Don't") || processMd.includes("Do / Don’t"),
    "process doc should have Do / Don't",
  );

  const promptMd = await Deno.readTextFile(".copilot/prompts/self-improvement-loop.md");
  assert(promptMd.includes("Key points"), "template should have Key points");
  assert(promptMd.includes("Canonical prompt (short)"), "template should have Canonical prompt (short)");
  assert(promptMd.includes("Examples"), "template should have Examples");
  assert(promptMd.includes("## Template"), "template should include a Template section");
});

Deno.test("Self-improvement loop: verify frontmatter schema + short_summary limits", async () => {
  const files = [
    ".copilot/process/self-improvement.md",
    ".copilot/prompts/self-improvement-loop.md",
  ];

  await assertFrontmatterSchemaAndShortSummary(files);
});

Deno.test("Self-improvement loop: verify provider docs reference common process", async () => {
  const providers = [
    ".copilot/providers/claude.md",
    ".copilot/providers/openai.md",
    ".copilot/providers/google.md",
  ];

  for (const providerPath of providers) {
    const md = await Deno.readTextFile(providerPath);
    assert(
      md.includes(".copilot/process/self-improvement.md"),
      `${providerPath} should reference .copilot/process/self-improvement.md`,
    );
    assert(
      md.includes(".copilot/prompts/self-improvement-loop.md"),
      `${providerPath} should reference .copilot/prompts/self-improvement-loop.md`,
    );
  }
});

Deno.test("Self-improvement loop: verify discovery docs mention the process", async () => {
  const crossRef = await Deno.readTextFile(".copilot/cross-reference.md");
  assert(
    crossRef.includes("Self-improvement loop for agent instructions"),
    "cross-reference should include self-improvement loop title",
  );
  assert(
    crossRef.includes("process/self-improvement.md") &&
      crossRef.includes("prompts/self-improvement-loop.md"),
    "cross-reference should link to process and template",
  );

  const promptsReadme = await Deno.readTextFile(".copilot/prompts/README.md");
  assert(
    promptsReadme.includes("self-improvement-loop.md"),
    "prompts README should include self-improvement-loop.md",
  );
});

Deno.test("Self-improvement loop: verify manifest includes new docs", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  assert(Array.isArray(manifest.docs), "Manifest should have docs array");

  const paths = manifest.docs.map((d: { path: string }) => d.path);
  assert(paths.includes(".copilot/process/self-improvement.md"), "Manifest should include process doc");
  assert(paths.includes(".copilot/prompts/self-improvement-loop.md"), "Manifest should include prompt template");

  const processDoc = manifest.docs.find((d: { path: string }) => d.path === ".copilot/process/self-improvement.md");
  assertExists(processDoc, "process doc should be in manifest");
  assert(Array.isArray(processDoc.chunks), "process doc should have chunks array");
  assert(processDoc.chunks.length > 0, "process doc should have at least 1 chunk");
});

Deno.test("Self-improvement loop: verify chunks were generated", async () => {
  const patterns = [
    "self-improvement.md.chunk",
    "self-improvement-loop.md.chunk",
  ];

  await assertChunksWereGenerated(patterns);
});
