/**
 * @module CheckCodeStyleRulesOptionsTest
 * @path packages/lint-policy/tests/check_code_style_rules_options_test.ts
 * @description In-process `checkSource` cases proving catalog options drive rule behavior.
 */

import { assertEquals } from "@std/assert";
import { checkSource } from "../src/checkers/check_code_style.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";

const PROD = "packages/x/src/a.ts";

Deno.test("checkSource returns in-process findings without printing", () => {
  const source = "export const gated = edition === 'team';\n";
  const findings = checkSource(PROD, source, loadPolicyCatalog(catalogJson));
  assertEquals(
    findings.some((f) => f.rule === "edition-conditional-outside-composer" && f.line === 1 && f.severity === "error"),
    true,
  );
});
