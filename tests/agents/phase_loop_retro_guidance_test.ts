/**
 * @module PhaseLoopRetroGuidanceTest
 * @path tests/agents/phase_loop_retro_guidance_test.ts
 * @description Verifies the skills carry the process rules found by the Phase 204 retro: stage
 *   files before the staged-only gates run, verify that production supplies optional
 *   dependencies, check importers after an export changes, run the duplication gate for new
 *   integration tests, make review assertions falsifiable, and keep the agent-prose
 *   advisory note consistent.
 */

import { assertStringIncludes } from "@std/assert";

async function skill(name: string): Promise<string> {
  const text = await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`);
  return text.replace(/\s+/g, " ");
}

function requireAll(md: string, skillName: string, phrases: string[]): void {
  for (const phrase of phrases) {
    assertStringIncludes(md, phrase, `${skillName} should contain: ${phrase}`);
  }
}

Deno.test("Agent docs: next-steps stages files before the staged-only gates", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "Stage the step's files BEFORE running",
    "pass vacuously",
    "sentences of at most 20 words and no semicolons",
  ]);
});

Deno.test("Agent docs: next-steps covers a user preference that forbids a plan field", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "forbids a `plan:` field",
    "commit the submodule plan doc first",
  ]);
});

Deno.test("Agent docs: next-steps and the completion gate verify optional dependencies are supplied", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "confirm production supplies it",
    "G1 also requires that the production caller passes each optional dependency",
  ]);
});

Deno.test("Agent docs: next-steps checks importers after an export changes and runs duplication for integration tests", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "grep every importer, including `tests/`",
    "repo-wide `deno task check`",
    "`deno task check:duplication` when the step adds integration or scenario test code",
  ]);
});

Deno.test("Agent docs: next-steps scopes the duplication gate to stubs, rebuilds binaries and copies submodules into a base worktree", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "adds or edits test doubles, stubs, fixtures or command handlers",
    "`ci.ts check` does not run it",
    "cp -a <submodule>/. <dir>/<submodule>/",
    "Tests that run a compiled binary read `dist/bin`",
    "A stale build fails those tests",
  ]);
});

Deno.test("Agent docs: review-phase-code traces every enforcing layer and requires falsifiable assertions", async () => {
  requireAll(await skill("review-phase-code"), "review-phase-code", [
    "trace every layer that can enforce it",
    "Would this assertion fail if the feature were removed",
    "grep the production call-site and confirm it supplies each optional",
  ]);
});

Deno.test("Agent docs: review-phase-code verifies execution, population and artifact freshness", async () => {
  requireAll(await skill("review-phase-code"), "review-phase-code", [
    "positive execution evidence",
    "intended input population",
    "producer revision and configuration",
    "checksums prove integrity",
  ]);
});

Deno.test("Agent docs: clean-codebase treats unclassified agent-prose output as advisory", async () => {
  requireAll(await skill("clean-codebase"), "clean-codebase", [
    "advisory by the Phase 195 decision",
    "do not invent classifications",
  ]);
});

Deno.test("Docs: the integration README points new flow-binding tests at the shared harness", async () => {
  const md = (await Deno.readTextFile("tests/integration/README.md")).replace(/\s+/g, " ");
  assertStringIncludes(
    md,
    "helpers/flow_binding_harness.ts",
    "integration README should name the shared binding harness",
  );
});

Deno.test("Agent docs: submodule-workflow covers a plan step whose source is a source submodule", async () => {
  requireAll(await skill("submodule-workflow"), "submodule-workflow", [
    "Source-submodule plan step",
    "Do not run `commit_plan_step.ts`",
  ]);
});

Deno.test("Agent docs: a delegated review-code report is required before closure", async () => {
  requireAll(await skill("next-steps"), "next-steps", [
    "G8. Delegated review report",
    "review-code pending",
  ]);
  requireAll(await skill("review-phase-code"), "review-phase-code", [
    "is not closeable",
  ]);
});

Deno.test("Agent docs: clean-codebase preflights writable Docker and sandbox state", async () => {
  requireAll(await skill("clean-codebase"), "clean-codebase", [
    "DOCKER_CONFIG",
    "EXA_SANDBOX_BASE",
    "Never put `DENO_DIR`",
  ]);
});

Deno.test("Agent docs: test-development names the second pinned serial list", async () => {
  requireAll(await skill("test-development"), "test-development", [
    "EXPECTED_SEQUENTIAL_FILES",
    "__temp_",
  ]);
});

Deno.test("Agent docs: test-development covers scoped-permission runs", async () => {
  const md = await skill("test-development");
  assertStringIncludes(md, "Scoped-permission runs", "test-development should name scoped-permission runs");
  assertStringIncludes(md, "`Deno.symlink`", "test-development should name the symlink restriction");
  assertStringIncludes(md, "skip the case when the run is scoped", "test-development should prescribe a skip");
});

Deno.test("Agent docs: self-improvement keeps an externally blocked phase open", async () => {
  const md = await skill("self-improvement");
  assertStringIncludes(md, "external closure rows", "self-improvement should allow external closure rows");
  assertStringIncludes(
    md,
    "`#review-phase-code` pass can reopen a phase",
    "self-improvement should warn that a review can reopen the phase",
  );
  assertStringIncludes(md, "do not flatten the", "self-improvement should forbid a flat complete status");
});

Deno.test("Agent docs: test and review skills reject historical phase assertions", async () => {
  requireAll(await skill("test-development"), "test-development", [
    "HISTORICAL PHASE STATE",
    "not a contract",
    "committed live baseline",
    "phase-closure audit",
  ]);
  requireAll(await skill("review-code"), "review-code", [
    "historical phase state is not a contract",
    "committed live baseline",
  ]);
  requireAll(await skill("review-phase-code"), "review-phase-code", [
    "historical plan",
    "committed baseline",
  ]);
});
