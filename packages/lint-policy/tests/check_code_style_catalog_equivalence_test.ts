/**
 * @module CheckCodeStyleCatalogEquivalenceTest
 * @path packages/lint-policy/tests/check_code_style_catalog_equivalence_test.ts
 * @description Locks the catalog-driven findings and proves catalog/code rule parity.
 */

import { assertEquals } from "@std/assert";
import { checkSource, IMPLEMENTED_SCRIPT_RULE_IDS } from "../src/checkers/check_code_style.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";

const PROD = "packages/x/src/a.ts";

Deno.test("catalog covers exactly the implemented script rules", () => {
  const catalog = loadPolicyCatalog(catalogJson);
  const catalogScriptIds = Object.entries(catalog.rules)
    .filter(([, entry]) => entry.engine === "script")
    .map(([id]) => id);
  assertEquals(new Set(catalogScriptIds), new Set(IMPLEMENTED_SCRIPT_RULE_IDS));
});

Deno.test("checkSource findings are stable for the committed catalog", () => {
  const source = "export const gated = edition === 'team';\nexport const flag = edition !== 'solo';\n";
  const rules = checkSource(PROD, source, loadPolicyCatalog(catalogJson)).map((f) => f.rule).sort();
  assertEquals(rules, [
    "edition-conditional-outside-composer",
    "edition-conditional-outside-composer",
    "module-header",
  ]);
});
