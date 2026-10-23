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
  assert(md.includes("EXA_DAEMON_SCRIPT"), "clean-codebase should name the daemon script override");
  assert(
    normalized.includes("stat it with `isFile`"),
    "clean-codebase should state that EXA_BIN_PATH is a file for the direct synthetic runner",
  );
  assert(md.includes("DENO_DIR"), "clean-codebase should name the writable compile cache variable");
});
