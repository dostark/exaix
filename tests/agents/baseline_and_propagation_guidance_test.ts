/**
 * @module BaselineAndPropagationGuidanceTest
 * @path tests/agents/baseline_and_propagation_guidance_test.ts
 * @description Verifies the phase-loop skills carry the guidance found in the phase 212 retro:
 *   a failure claimed pre-existing must reproduce at the phase base commit, a relaxed rule must be
 *   probed against every registered subject, a config key claim must be traced to its consumer,
 *   new tests get the style gates early, and the remediation skill honors a saved commit preference.
 * @architectural-layer Test
 * @related-files [.copilot/skills/next-steps/SKILL.md, .copilot/skills/review-phase-code/SKILL.md]
 */

import { assert } from "@std/assert";

async function skill(name: string): Promise<string> {
  return await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`);
}

Deno.test("Agent docs: next-steps requires a base-commit reproduction before calling a failure pre-existing", async () => {
  const md = await skill("next-steps");
  assert(md.includes("pre-existing"), "next-steps should name the pre-existing claim");
  assert(
    md.includes("git worktree add --detach"),
    "next-steps should give the command that reproduces a failure at the phase base commit",
  );
  assert(
    md.includes("closed without a full run"),
    "next-steps should say that a step closed without a full run may own the next run's failures",
  );
});

Deno.test("Agent docs: next-steps traces config inputs and runs style gates right after writing tests", async () => {
  const md = await skill("next-steps");
  assert(
    md.includes("configuration input"),
    "next-steps VERIFY should extend presence-not-propagation to configuration inputs",
  );
  assert(
    md.includes("check:ste100-comments:staged"),
    "next-steps should run the comment gate after writing tests, not only at the final CI check",
  );
});

Deno.test("Agent docs: review-phase-code probes every registered subject when a step relaxes a rule", async () => {
  const md = await skill("review-phase-code");
  assert(md.includes("relaxes a filter"), "review-phase-code should name the relaxed-rule case");
  assert(
    md.includes("every registered subject"),
    "review-phase-code should require probing every registered subject against the real bootstrap",
  );
  assert(
    md.includes("PG-N"),
    "review-phase-code should number post-gap findings so they cannot collide with pre-gap numbers",
  );
});

Deno.test("Agent docs: review-phase-plan traces every config key from schema to consumer", async () => {
  const md = await skill("review-phase-plan");
  assert(
    md.includes("schema field") && md.includes("consumer"),
    "review-phase-plan should require the schema field, the passing factory and the consumer",
  );
  assert(
    md.includes("non-default value"),
    "review-phase-plan should require a planned test that sets a non-default value through the real factory",
  );
});

Deno.test("Agent docs: remediate-code-gaps honors a saved preference that forbids the plan field", async () => {
  const md = await skill("remediate-code-gaps");
  assert(
    md.includes("saved preference forbids a `plan:` field"),
    "remediate-code-gaps should carry the same escape that next-steps has",
  );
});

Deno.test("Agent docs: test-development reads private state through a public field or instanceof", async () => {
  const md = await skill("test-development");
  assert(
    md.includes("`public readonly` field") && md.replace(/\s+/g, " ").includes("narrow with `instanceof`"),
    "test-development should say to expose a public field or narrow with instanceof instead of a double cast",
  );
});

Deno.test("Agent docs: next-phase keeps the registry selected-work note to one line", async () => {
  const md = await skill("next-phase");
  assert(
    md.includes("one line") && md.includes("step or test counts"),
    "next-phase should keep the registry note to one line without step or test counts",
  );
});
