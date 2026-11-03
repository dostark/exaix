/**
 * @module CleanCodebaseGatesTest
 * @path tests/agents/clean_codebase_gates_test.ts
 * @description Guards the cleanup skill's classification of repository check gates.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [.copilot/skills/clean-codebase/SKILL.md]
 */

import { assertStringIncludes } from "@std/assert";

Deno.test("Agent docs: clean-codebase separates active gates from baseline diagnostics", async () => {
  const md = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");
  const normalized = md.replace(/\s+/g, " ");

  assertStringIncludes(md, "check:skill-duplication", "clean-codebase should include the skill-duplication gate");
  assertStringIncludes(
    md,
    "check:phase-references",
    "clean-codebase should record phase references as a baseline diagnostic",
  );
  assertStringIncludes(md, "check:agent-prose", "clean-codebase should record agent prose as a baseline diagnostic");
  assertStringIncludes(
    normalized,
    "not yet CI gates",
    "clean-codebase should distinguish failing baseline diagnostics from active CI gates",
  );
  assertStringIncludes(md, "EXA_DAEMON_SCRIPT", "clean-codebase should name the daemon script override");
  assertStringIncludes(
    normalized,
    "stat it with `isFile`",
    "clean-codebase should state that EXA_BIN_PATH is a file for the direct synthetic runner",
  );
  assertStringIncludes(md, "DENO_DIR", "clean-codebase should name the writable compile cache variable");
});

Deno.test("Agent docs: full-suite preflight compiles the CLI and checks the offline worker", async () => {
  const skill = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");
  const readme = await Deno.readTextFile("tests/README.md");

  assertStringIncludes(skill, "deno task build:solo --compile");
  assertStringIncludes(skill, "tests/README.md#local-full-suite-preflight");
  for (const phrase of ["--network=none", "--frozen-lockfile", "--no-lock", "host: true"]) {
    assertStringIncludes(readme, phrase, `preflight must document ${phrase}`);
  }
});
