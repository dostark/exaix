/**
 * @module DocAndSubmoduleGuidanceTest
 * @path tests/agents/doc_and_submodule_guidance_test.ts
 * @description Verifies five skill fixes from a style-guide rework: pushes need a direct request, staged files precede the CI check, a related-files entry names a repository file, docs check their code claims, and only a new plan is formatted.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [.copilot/skills/submodule-workflow/SKILL.md, .copilot/skills/doc/SKILL.md]
 */

import { assert } from "@std/assert";

async function skill(name: string): Promise<string> {
  return await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`);
}

Deno.test("Agent docs: submodule-workflow pushes only on a direct request and merges with --ff-only", async () => {
  const md = await skill("submodule-workflow");
  assert(md.includes("Push only when the user directly asks"), "the push rule is missing");
  assert(md.includes("`--ff-only`"), "the fast-forward merge rule is missing");
});

Deno.test("Agent docs: remediate-code-gaps stages files before the CI check", async () => {
  const md = await skill("remediate-code-gaps");
  assert(md.includes("Stage the step's files BEFORE `ci.ts check`"), "the staging rule is missing");
  assert(md.includes("pass vacuously on an empty index"), "the reason for staging first is missing");
});

Deno.test("Agent docs: exaix-development limits related-files entries to repository files", async () => {
  const md = await skill("exaix-development");
  assert(md.includes("a path inside a submodule fails check:arch"), "the related-files limit is missing");
});

Deno.test("Agent docs: doc checks code claims and names the claims test", async () => {
  const md = await skill("doc");
  assert(md.includes("Check every code-facing claim"), "the claim-check rule is missing");
  assert(md.includes("style_guide_claims_test.ts"), "the example claims test is missing");
});

Deno.test("Agent docs: plan formats only a new plan document", async () => {
  const md = await skill("plan");
  assert(md.includes("A NEW plan that no commit holds yet may"), "the new-plan formatting rule is missing");
  assert(md.includes("Never\n   format a committed plan"), "the committed-plan prohibition is missing");
});
