/**
 * @module OpenAIEnhancementsTest
 * @path tests/agents/openai_enhancements_test.ts
 * @description Verifies agent documentation structural integrity.
 */

import { assert } from "@std/assert";

Deno.test("OpenAI enhancements: verify manifest exists and readable", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);
  assert(Array.isArray(manifest.docs), "Manifest should have docs array");
});
