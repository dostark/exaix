/**
 * @module CIGuidanceTest
 * @path tests/agents/ci_guidance_test.ts
 * @description Verifies the project's CI guidance documentation, ensuring that
 * common CI pitfalls and best practices are correctly documented for agents.
 */

import { assert, assertStringIncludes } from "@std/assert";

Deno.test("Agent docs: test-development skill documents CI pitfalls", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(md, "CI pitfalls", "test-development skill should have a CI section");
  assertStringIncludes(md, "CI=true", "CI section should mention CI=true behavior");
  assertStringIncludes(md, "@exaix/core/config/env_schema.ts", "CI section should reference shared env helpers");
  assertStringIncludes(md, "EXA_TEST_ENABLE_PAID_LLM", "CI section should mention paid LLM opt-in");
  assertStringIncludes(md, "Deno.execPath()", "CI section should describe running exactl via Deno.execPath()");
});

Deno.test("Agent docs: test-development skill documents module-init env access for standalone runs", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(md, "Permissions", "test-development skill should have a Permissions section");
  assertStringIncludes(md, "TSC_WATCHFILE", "Permissions section should name the typescript module-init env read");
  assertStringIncludes(
    md,
    "deno test --allow-all",
    "Permissions section should recommend --allow-all for standalone runs",
  );
});

Deno.test("Agent docs: focused Deno canaries must prove non-zero test selection", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(md, "multiple-name filters use a regex literal");
  assertStringIncludes(md, "Treat zero selected tests as a failed verification");
  assertStringIncludes(md, "--filter '/first case|second case/'");
});

Deno.test("Agent docs: completion evidence must survive session restarts", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(/must not be the sole\s+user-facing proof artifact/.test(md));
  assertStringIncludes(md, "durable, phase-named workspace/sandbox output directory");
});

Deno.test("Agent docs: test-development skill documents the execution-time budget", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(md, "Execution-time budget", "skill should have an execution-time budget section");
  assertStringIncludes(md, "daemon.ready", "skill should point at the daemon.ready readiness signal");
  assertStringIncludes(md, "daemon_commands.ts", "skill should note the daemon lifecycle commands block until ready");
  assertStringIncludes(md, "prepareDeclaredPortals", "skill should warn against re-doing the runner's portal mount");
  assertStringIncludes(md, "Promise.allSettled", "skill should recommend concurrent independent I/O");
  assertStringIncludes(md, "SEQUENTIAL_FILES", "skill should route process-sensitive tests to the sequential batch");
});

Deno.test("Agent docs: local completion validation is focused by default", async () => {
  const agentInstructions = await Deno.readTextFile("AGENTS.md");
  const nextSteps = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assertStringIncludes(agentInstructions, "focused, file-scoped validation");
  assertStringIncludes(agentInstructions, "Do not run `deno run -A scripts/ci.ts all` as a default local check");
  assert(
    !agentInstructions.includes(
      "Before any PR handoff or completion claim, run `deno run -A scripts/ci.ts all`",
    ),
  );
  assertStringIncludes(nextSteps, "Use focused, file-scoped test commands during implementation");
});

for (
  const name of [
    "tdd-workflow",
    "test-development",
    "next-steps",
    "commit",
    "clean-codebase",
    "upgrade-version",
    "edition-development",
    "exaix-development",
    "coverage",
  ]
) {
  Deno.test(`Agent docs: ${name} keeps coverage manual-only`, async () => {
    const md = (await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`)).replace(/\s+/g, " ");
    assertStringIncludes(md, "manual-only", `${name} must state the manual-only measurement policy`);
    assertStringIncludes(md, "AGENTS.md", `${name} must reference the governing instructions`);
    assert(/(?:explicit.{0,35}request|request.{0,35}explicit)/i.test(md), `${name} must require a user request`);
    assert(!/re-runs the suite for coverage|check \+ test \+ coverage|static gates, coverage, and a build/.test(md));
  });
}

Deno.test("Agent docs: next-steps skill runs the full suite in CI mode and unsets CI only for grepped files", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assertStringIncludes(md, "CI=true deno task test_all", "the repository-wide suite must run in CI mode");
  assertStringIncludes(md, "live-provider tests", "the guidance must say why CI mode matters");
  assertStringIncludes(md, "Unset `CI` only for the grepped files");
});

Deno.test("Agent docs: test-development skill limits assertFalse to a defined boolean", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(md, "`assertFalse(x)` only when `x` is a defined boolean");
  assertStringIncludes(md, "`assertFalse` passes on it");
});
