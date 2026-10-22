/**
 * @module GenericRulesPortedTest
 * @path packages/lint-policy/tests/generic_rules_ported_test.ts
 * @description Guards rule ownership after the generic checks move into the engine.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/tests/fixtures/port/port_tables.json, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { assert, assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import catalogJson from "./fixtures/catalog_v1.json" with { type: "json" };
import { IMPLEMENTED_SCRIPT_RULE_IDS } from "../src/checkers/check_code_style.ts";
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { findBareIdReferences, portReferenceFiles } from "./helpers/port_migration.ts";
import { type IPortTables, loadPortTables, PORT_OUTCOME } from "./helpers/port_tables.ts";

interface IGuardRule {
  readonly engine: string;
}

interface IGuardCatalog {
  readonly rules: Readonly<Record<string, IGuardRule>>;
  readonly wholeTree?: { readonly magicLiterals?: { readonly additionalStrings?: readonly string[] } };
}

const WHOLE_TREE_HOSTS = new Set(["duplicate-type", "duplicate-constant"]);
const WHOLE_TREE_SETTINGS_ID = "magic-literals";
const PLUGIN_ID = "exaix/import-placement";
const BOUNDARY_ID = "exaix/import-boundaries";

function catalogGaps(catalog: IGuardCatalog, tables: IPortTables): string[] {
  const gaps: string[] = [];
  const projectIds = new Set(
    tables.rules.flatMap((row) => row.parts.filter((part) => part.part === PORT_OUTCOME.exaix).map((part) => part.key)),
  );
  for (const [id, rule] of Object.entries(catalog.rules)) {
    if (rule.engine === "script" && !projectIds.has(id) && !WHOLE_TREE_HOSTS.has(id)) {
      gaps.push(`${id}: unexpected script rule`);
    }
  }
  for (const row of tables.rules) {
    for (const part of row.parts.filter((part) => part.part === PORT_OUTCOME.generic)) {
      if (WHOLE_TREE_HOSTS.has(part.key)) {
        if (catalog.rules[part.key]?.engine !== "script") gaps.push(`${part.key}: missing whole-tree host`);
      } else if (part.key === WHOLE_TREE_SETTINGS_ID) {
        if (!catalog.wholeTree?.magicLiterals) gaps.push(`${part.key}: missing whole-tree settings`);
      } else {
        const id = `${EXAIX_PLUGIN_NAME}/${part.key}`;
        if (catalog.rules[id]?.engine !== "plugin") gaps.push(`${id}: generic rule is not hosted by the plugin`);
      }
    }
  }
  return gaps;
}

Deno.test("all generic per-file rules use the plugin and only whole-tree libraries retain script hosts", async () => {
  assertEquals(catalogGaps(catalogJson, await loadPortTables()), []);
});

Deno.test("the ownership guard rejects a generic plugin rule moved back into a script host", async () => {
  const broken = { ...catalogJson, rules: { ...catalogJson.rules, [PLUGIN_ID]: { engine: "script" } } };
  assertArrayIncludes(catalogGaps(broken, await loadPortTables()), [
    `${PLUGIN_ID}: unexpected script rule`,
    `${PLUGIN_ID}: generic rule is not hosted by the plugin`,
  ]);
});

Deno.test("the ownership guard requires the whole-tree library hosts and their settings", async () => {
  const broken = { rules: { ...catalogJson.rules, "duplicate-type": { engine: "plugin" } } };
  const gaps = catalogGaps(broken, await loadPortTables());
  assertArrayIncludes(gaps, ["duplicate-type: missing whole-tree host"]);
  assertEquals(gaps.filter((gap) => gap.endsWith(": missing whole-tree settings")).length, 1);
});

Deno.test("every old boundary rule is catalog zone data rather than a separate implementation", async () => {
  const tables = await loadPortTables();
  const zoneIds = new Set(catalogJson.rules[BOUNDARY_ID].options.zones.map((zone) => zone.id));
  const ids = new Set(Object.keys(catalogJson.rules));
  for (const row of tables.rules.filter((row) => row.outcome === PORT_OUTCOME.zone)) {
    assert(zoneIds.has(row.id), `${row.id} has no boundary zone`);
    assertFalse(ids.has(row.id), `${row.id} still has its own catalog rule`);
    assertFalse(IMPLEMENTED_SCRIPT_RULE_IDS.has(row.id), `${row.id} still has a script implementation`);
  }
});

Deno.test("the style checker implements only project rules and whole-tree library hosts", async () => {
  const tables = await loadPortTables();
  const allowed = new Set([
    ...WHOLE_TREE_HOSTS,
    ...tables.rules.flatMap((row) =>
      row.parts.filter((part) => part.part === PORT_OUTCOME.exaix).map((part) => part.key)
    ),
  ]);
  assertEquals([...IMPLEMENTED_SCRIPT_RULE_IDS].filter((id) => !allowed.has(id)), []);
});

Deno.test("active tracked consumers name no bare ported rule id", async () => {
  const tables = await loadPortTables();
  const files = await portReferenceFiles();
  for (const row of tables.rules.filter((row) => row.ported)) {
    const searched = row.outcome === PORT_OUTCOME.zone
      ? new Map([...files].filter(([path]) => path !== "packages/lint-policy/tests/fixtures/catalog_v1.json"))
      : files;
    assertEquals(findBareIdReferences(searched, row.id), [], `${row.id} still has a bare consumer`);
  }
});
