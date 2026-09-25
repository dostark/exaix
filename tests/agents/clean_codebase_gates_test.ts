/**
 * @module CleanCodebaseGatesTest
 * @path tests/agents/clean_codebase_gates_test.ts
 * @description Guards the cleanup skill's classification of repository check gates.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [.copilot/skills/clean-codebase/SKILL.md]
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: clean-codebase separates active gates from baseline diagnostics", async () => {
  const md = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");
  const normalized = md.replace(/\s+/g, " ");

  assert(md.includes("check:skill-duplication"), "clean-codebase should include the skill-duplication gate");
  assert(
    md.includes("check:phase-references"),
    "clean-codebase should record phase references as a baseline diagnostic",
  );
  assert(md.includes("check:agent-prose"), "clean-codebase should record agent prose as a baseline diagnostic");
  assert(
    normalized.includes("not yet CI gates"),
    "clean-codebase should distinguish failing baseline diagnostics from active CI gates",
  );
});
