/**
 * @module NextStepsResumeGuidanceTest
 * @path tests/agents/next_steps_resume_guidance_test.ts
 * @description Verifies the next-steps skill documents two session-resume gotchas
 * found during phase-163's self-improvement-retro: (1) chat/session memory is not
 * reliable evidence of phase progress after a compaction or when another agent/tool
 * may have worked on the same phase — `git log` and the plan doc's own Status markers
 * must be checked first; (2) an agent shell's default `CI=true` silently skips
 * `ignore: Deno.env.get("CI") === "true"` real-subprocess/`[live]` tests, so the
 * Phase-Completion Gate's G5 must explicitly re-run them with `CI` unset before
 * trusting a green summary.
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: next-steps requires git-log re-grounding over chat memory when resuming", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assert(
    md.includes("Chat/session memory is not reliable evidence on its own"),
    "next-steps should warn that chat memory alone is not reliable phase-progress evidence",
  );
  assert(
    md.includes("git log --oneline"),
    "next-steps should direct re-grounding via git log before resuming a phase",
  );
  assert(
    md.includes("another agent/tool"),
    "next-steps should call out the case where a different agent/tool worked on the phase in the interim",
  );
});

Deno.test("Agent docs: next-steps G5 warns that CI=true silently skips real-subprocess/[live] tests", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assert(
    md.includes("Agent shells commonly have `CI=true` set"),
    "next-steps G5 should warn about the default CI=true shell environment",
  );
  assert(
    md.includes("env -u CI"),
    "next-steps G5 should give the exact command to re-run tests with CI unset",
  );
  assert(
    md.includes("ignore:.*CI"),
    "next-steps G5 should give the grep pattern to find CI-gated tests before the gate closes",
  );
});
