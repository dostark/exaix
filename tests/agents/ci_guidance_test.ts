/**
 * @module CIGuidanceTest
 * @path tests/agents/ci_guidance_test.ts
 * @description Verifies the project's CI guidance documentation, ensuring that
 * common CI pitfalls and best practices are correctly documented for agents.
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: test-development skill documents CI pitfalls", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(md.includes("CI pitfalls"), "test-development skill should have a CI section");
  assert(md.includes("CI=true"), "CI section should mention CI=true behavior");
  assert(md.includes("@exaix/core/config/env_schema.ts"), "CI section should reference shared env helpers");
  assert(md.includes("EXA_TEST_ENABLE_PAID_LLM"), "CI section should mention paid LLM opt-in");
  assert(md.includes("Deno.execPath()"), "CI section should describe running exactl via Deno.execPath()");
});
