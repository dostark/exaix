/**
 * @module PhaseLoopRetroGuidanceTest
 * @path tests/agents/phase_loop_retro_guidance_test.ts
 * @description Verifies the skills carry the process rules found by the Phase 204 retro: stage
 *   files before the staged-only gates run, verify that production supplies optional
 *   dependencies, check importers after an export changes, run the duplication gate for new
 *   integration tests, make review assertions falsifiable, and keep the agent-prose
 *   advisory note consistent.
 */

import { assert } from "@std/assert";

async function skill(name: string): Promise<string> {
  const text = await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`);
  return text.replace(/\s+/g, " ");
}

function requireAll(md: string, skillName: string, phrases: string[]): void {
  for (const phrase of phrases) {
    assert(md.includes(phrase), `${skillName} should contain: ${phrase}`);
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

Deno.test("Agent docs: review-phase-code traces every enforcing layer and requires falsifiable assertions", async () => {
  requireAll(await skill("review-phase-code"), "review-phase-code", [
    "trace every layer that can enforce it",
    "Would this assertion fail if the feature were removed",
    "grep the production call-site and confirm it supplies each optional",
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
  assert(md.includes("helpers/flow_binding_harness.ts"), "integration README should name the shared binding harness");
});
