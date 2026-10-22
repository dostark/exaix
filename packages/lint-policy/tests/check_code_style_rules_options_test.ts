/**
 * @module CheckCodeStyleRulesOptionsTest
 * @path packages/lint-policy/tests/check_code_style_rules_options_test.ts
 * @description In-process `checkSource` cases proving catalog options drive rule behavior.
 */

import { assert, assertEquals } from "@std/assert";
import { checkSource } from "../src/checkers/check_code_style.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { LAYOUT } from "../src/repo_layout.ts";
import { SCRIPT_RULE_SCHEMAS } from "../src/script_rule_schemas.ts";

const PROD = "packages/x/src/a.ts";

Deno.test("checkSource returns in-process findings without printing", () => {
  const source = "export const gated = edition === 'team';\n";
  const findings = checkSource(PROD, source, loadPolicyCatalog(catalogJson));
  assertEquals(
    findings.some((f) => f.rule === "edition-conditional-outside-composer" && f.line === 1 && f.severity === "error"),
    true,
  );
});

Deno.test("extracted_script_schema_preserves_existing_options", () => {
  const edition = SCRIPT_RULE_SCHEMAS["edition-leak"];
  const duplicateConstant = SCRIPT_RULE_SCHEMAS["duplicate-constant"];
  const duplicateType = SCRIPT_RULE_SCHEMAS["duplicate-type"];
  assert(edition && duplicateConstant && duplicateType);
  assertEquals(edition.parse({}), {
    soloTier: 0,
    teamTier: 1,
    enterpriseTier: 2,
    soloPrefixes: [LAYOUT.packageRoot, LAYOUT.appRoot],
    teamPrefixes: [LAYOUT.teamRoot],
    enterprisePrefixes: [LAYOUT.enterpriseRoot],
    teamAppPaths: [LAYOUT.teamAppBootstrap],
  });
  assertEquals(duplicateConstant.safeParse({ namePattern: "^[A-Z][A-Z0-9_]*$", allow: [] }).success, true);
  assertEquals(duplicateConstant.safeParse({ namePattern: 3 }).success, false);
  assertEquals(duplicateType.safeParse({ minProperties: 2, allow: [] }).success, true);
  assertEquals(duplicateType.safeParse({ minProperties: 0 }).success, false);
});
