/**
 * @module OpenAIEnhancementsTest
 * @path tests/agents/openai_enhancements_test.ts
 * @description Verifies specialized documentation for OpenAI GPT agents,
 * ensuring structural integrity of agent definitions.
 */

// Unit tests to verify Step 10.6 OpenAI enhancements are properly implemented

import { assert } from "@std/assert";
import {
  assertChunksWereGenerated,
  assertFilesExist,
  assertFrontmatterSchemaAndShortSummary,
} from "../helpers/copilot_assertions.ts";
import { inject } from "../../scripts/inject_agent_context.ts";

Deno.test("OpenAI enhancements: verify required files exist", async () => {
  const files = [
    ".copilot/providers/openai.md",
    ".copilot/cross-reference.md",
    ".copilot/prompts/openai-quickstart.md",
    ".copilot/prompts/openai-tdd-workflow.md",
    ".copilot/prompts/openai-debugging-systematic.md",
  ];

  await assertFilesExist(files);
});

Deno.test("OpenAI enhancements: verify openai.md required sections", async () => {
  const md = await Deno.readTextFile(".copilot/providers/openai.md");

  assert(md.includes("Key points"), "Should have Key points");
  assert(/Canonical prompt \(short\)/.test(md), "Should have Canonical prompt (short)");
  assert(/Examples/i.test(md), "Should have Examples");
  assert(md.includes("Do / Don't"), "Should have Do / Don't");

  // Medium priority guardrails
  assert(md.includes("Output format (required)"), "Should define output format contract");
  assert(md.includes("Ask-when-ambiguous rule"), "Should define ask-when-ambiguous rule");
  assert(md.includes("Examples (by level)"), "Should include multi-level examples");
});

Deno.test("OpenAI enhancements: verify frontmatter schema + short_summary limits", async () => {
  const files = [
    ".copilot/providers/openai.md",
    ".copilot/prompts/openai-quickstart.md",
    ".copilot/prompts/openai-tdd-workflow.md",
    ".copilot/prompts/openai-debugging-systematic.md",
  ];

  await assertFrontmatterSchemaAndShortSummary(files);
});

Deno.test("OpenAI enhancements: verify manifest includes openai docs", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  assert(Array.isArray(manifest.docs), "Manifest should have docs array");

  const paths = manifest.docs.map((d: { path: string }) => d.path);
  assert(paths.includes(".copilot/providers/openai.md"), "Manifest should include openai.md");
});

Deno.test("OpenAI enhancements: verify chunks were generated", async () => {
  const patterns = [
    "openai.md.chunk",
  ];

  await assertChunksWereGenerated(patterns);
});

Deno.test("OpenAI enhancements: verify context injection works", async () => {
  const result = await inject("openai", "OpenAI TDD workflow", 4);
  assert(result.found, "Should find OpenAI-related doc");
  assert(
    (result.path || "").includes(".copilot/providers/openai") ||
      (result.path || "").includes(".copilot/prompts/openai-"),
    "Should return an OpenAI agent doc or OpenAI prompt template",
  );
});
