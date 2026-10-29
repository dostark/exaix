/**
 * @module ComplexityCutoverTest
 * @path packages/lint-policy/tests/complexity_cutover_test.ts
 * @description Proves the parent gate stays on the classic cyclomatic pin while the engine default counts extended.
 * @architectural-layer Test
 * @dependencies [@std/assert, @dostark/unslop-ts]
 * @related-files [../../../unslop.config.json, ./fixtures/catalog_v1.json, ../src/policy_config.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { type ICatalog, type JsonValue, parseCatalog } from "@dostark/unslop-ts";
import { createDenoPlugin, runPlugin } from "@dostark/unslop-ts/deno";
import { EXAIX_REGISTRY, EXAIX_RULE_PACKS } from "../src/rule_packs.ts";
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { POLICY_CATALOG, POLICY_COMPILED } from "../src/policy_config.ts";
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import catalogFixture from "./fixtures/catalog_v1.json" with { type: "json" };

const RULE_ID = `${EXAIX_PLUGIN_NAME}/max-cyclomatic-complexity`;
const FIXTURE_PATH = "packages/x/src/wide.ts";
const PARENT_LIMIT = 15;
const NULLISH_DECISIONS = 16;
const NULLISH_EXTENDED = 1 + NULLISH_DECISIONS;

/** A function whose extended count passes the limit while its classic count stays at one. */
function wideSource(): string {
  const lines = ["export function wide(value: number | null): number {"];
  for (let index = 0; index < NULLISH_DECISIONS; index++) {
    lines.push(`  const item${index} = value ?? ${index};`);
  }
  lines.push(`  return ${Array.from({ length: NULLISH_DECISIONS }, (_, index) => `item${index}`).join(" + ")};`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** The cyclomatic diagnostics the plugin reports for one fixture path. */
function cyclomaticMessages(catalog: ICatalog, source: string): string[] {
  const plugin = createDenoPlugin(EXAIX_PLUGIN_NAME, catalog, { rulePacks: EXAIX_RULE_PACKS });
  return runPlugin(plugin, FIXTURE_PATH, source)
    .filter((diagnostic) => diagnostic.id === RULE_ID)
    .map((diagnostic) => diagnostic.message);
}

/** A catalog that enables only the complexity rule, so the engine supplies its own default variant. */
function defaultVariantCatalog(): ICatalog {
  const catalog: Record<string, JsonValue> = {
    version: "1",
    scopes: { test: [], fixture: [] },
    tagVocabulary: { complexity: { description: "Function size limits." } },
    rules: {
      [RULE_ID]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["complexity"],
        options: { max: PARENT_LIMIT },
      },
    },
  };
  return parseCatalog(catalog, { scriptRuleSchemas: null, registry: EXAIX_REGISTRY });
}

Deno.test("classic-parent-transition: the parent catalog pins the classic variant in every copy", () => {
  const entry = POLICY_CATALOG.rules[RULE_ID];
  assert(entry !== undefined, RULE_ID);
  assertEquals(entry.options?.variant, "classic");
  assertEquals(POLICY_COMPILED.rules[RULE_ID].effectiveOptions?.variant, "classic");
  const fixture = loadPolicyCatalog(catalogFixture as JsonValue);
  assertEquals(fixture.rules[RULE_ID].options?.variant, "classic");
});

Deno.test("classic-parent-transition: the parent gate stays classic while a default engine fixture counts extended", () => {
  const source = wideSource();
  const defaults = cyclomaticMessages(defaultVariantCatalog(), source);
  assertEquals(defaults.length, 1);
  assert(defaults[0].includes(`${NULLISH_EXTENDED} (limit ${PARENT_LIMIT})`), defaults[0]);
  assertEquals(cyclomaticMessages(POLICY_CATALOG, source), []);
});
