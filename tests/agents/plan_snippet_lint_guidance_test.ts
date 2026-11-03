/**
 * @module PlanSnippetLintGuidanceTest
 * @path tests/agents/plan_snippet_lint_guidance_test.ts
 * @description Verifies the plan skill warns that plan-doc code snippets must be
 * lint-clean (no inline npm:/jsr:/https: specifiers), so a plan's own Technical
 * Architecture / Action examples never block a later implementer with a deno lint
 * rejection. Regression for phase-165 GAP-2 remediation, where the plan documented
 * `import babelPkg from "npm:@babel/parser/package.json"` — an inline npm: specifier
 * that fails `no-import-prefix` + `no-unversioned-import` — and the implementer had
 * to add a deno.json import-map alias to match the doc.
 */

import { assertStringIncludes } from "@std/assert";

Deno.test("Agent docs: plan skill requires lint-clean snippets (import-map aliases, no inline npm:)", async () => {
  const md = await Deno.readTextFile(".copilot/skills/plan/SKILL.md");

  assertStringIncludes(md, "no-import-prefix", "plan skill should reference the no-import-prefix lint rule");
  assertStringIncludes(md, "no-unversioned-import", "plan skill should reference the no-unversioned-import lint rule");
  assertStringIncludes(
    md,
    "import-map alias",
    "plan skill should direct snippet authors to deno.json import-map aliases",
  );
  assertStringIncludes(md, "@babel/parser/package.json", "plan skill should carry a concrete import-map alias example");
});
