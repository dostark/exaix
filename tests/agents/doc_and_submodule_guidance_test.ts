/**
 * @module DocAndSubmoduleGuidanceTest
 * @path tests/agents/doc_and_submodule_guidance_test.ts
 * @description Verifies five skill fixes from a style-guide rework: pushes need a direct request, staged files precede the CI check, a related-files entry names a repository file, docs check their code claims, and only a new plan is formatted.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [.copilot/skills/submodule-workflow/SKILL.md, .copilot/skills/doc/SKILL.md]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

async function skill(name: string): Promise<string> {
  return await Deno.readTextFile(`.copilot/skills/${name}/SKILL.md`);
}

Deno.test("Agent docs: submodule-workflow pushes only on a direct request and merges with --ff-only", async () => {
  const md = await skill("submodule-workflow");
  assertStringIncludes(md, "Push only when the user directly asks", "the push rule is missing");
  assertStringIncludes(md, "`--ff-only`", "the fast-forward merge rule is missing");
});

Deno.test("Agent docs: remediate-code-gaps stages files before the CI check", async () => {
  const md = await skill("remediate-code-gaps");
  assertStringIncludes(md, "Stage the step's files BEFORE `ci.ts check`", "the staging rule is missing");
  assertStringIncludes(md, "pass vacuously on an empty index", "the reason for staging first is missing");
});

Deno.test("Agent docs: exaix-development limits related-files entries to repository files", async () => {
  const md = await skill("exaix-development");
  assertStringIncludes(md, "a path inside a submodule fails check:arch", "the related-files limit is missing");
});

Deno.test("Agent docs: doc checks code claims and names the claims test", async () => {
  const md = await skill("doc");
  assertStringIncludes(md, "Check every code-facing claim", "the claim-check rule is missing");
  assertStringIncludes(md, "style_guide_claims_test.ts", "the example claims test is missing");
});

Deno.test("Agent docs: doc refreshes the title and checks command names", async () => {
  const md = await skill("doc");
  assertStringIncludes(md, "title and introduction state the current scope", "the title rule is missing");
  assertStringIncludes(md, "Command names match the shipped executable or task", "the command-name rule is missing");
});

Deno.test("Agent docs: plan formats only a new plan document", async () => {
  const md = await skill("plan");
  assertStringIncludes(md, "A NEW plan that no commit holds yet may", "the new-plan formatting rule is missing");
  assertStringIncludes(md, "Never\n   format a committed plan", "the committed-plan prohibition is missing");
});

Deno.test("Agent docs: active guidance cites no environment validation function that the code lacks", async () => {
  const files = [
    "CONTRIBUTING.md",
    "docs/CODE_STYLE.md",
    ".copilot/skills/infra/SKILL.md",
    ".copilot/skills/exaix-development/SKILL.md",
  ];
  const stale = "getValidatedEnvOverrides";
  const holders: string[] = [];
  for (const path of files) {
    if ((await Deno.readTextFile(path)).includes(stale)) holders.push(path);
  }
  assertEquals(holders, []);
});

Deno.test("Agent docs: self-improvement runs the skill-reading tests after a patch", async () => {
  const md = await skill("self-improvement");
  assertStringIncludes(md, "tests/scripts/dogfood_skill_folders_test.ts", "the baseline test command is missing");
  assertStringIncludes(md, "EDITED_SINCE_BASELINE", "the baseline list rule is missing");
});
