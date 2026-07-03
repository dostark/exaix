/**
 * @module OpenAIEnhancementsTest
 * @path tests/agents/openai_enhancements_test.ts
 * @description Verifies agent documentation structural integrity.
 */

import { assert } from "@std/assert";

Deno.test("OpenAI enhancements: verify cross-reference exists", async () => {
  const crossRef = await Deno.readTextFile(".copilot/cross-reference.md");
  assert(!!crossRef, "cross-reference.md should be readable");
});

Deno.test("OpenAI enhancements: verify manifest exists", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);
  assert(Array.isArray(manifest.docs), "Manifest should have docs array");
});
