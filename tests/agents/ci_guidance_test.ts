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

Deno.test("Agent docs: test-development skill documents module-init env access for standalone runs", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(md.includes("Permissions"), "test-development skill should have a Permissions section");
  assert(md.includes("TSC_WATCHFILE"), "Permissions section should name the typescript module-init env read");
  assert(md.includes("deno test --allow-all"), "Permissions section should recommend --allow-all for standalone runs");
});

Deno.test("Agent docs: focused Deno canaries must prove non-zero test selection", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(md.includes("multiple-name filters use a regex literal"));
  assert(md.includes("Treat zero selected tests as a failed verification"));
  assert(md.includes("--filter '/first case|second case/'"));
});

Deno.test("Agent docs: completion evidence must survive session restarts", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(/must not be the sole\s+user-facing proof artifact/.test(md));
  assert(md.includes("durable, phase-named workspace/sandbox output directory"));
});
