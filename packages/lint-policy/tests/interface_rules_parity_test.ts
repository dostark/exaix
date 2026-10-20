/**
 * @module InterfaceRulesParityTest
 * @path packages/lint-policy/tests/interface_rules_parity_test.ts
 * @description Checks that the plugin port of the interface rename rule match the old script findings, except for recorded AST corrections.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts, packages/lint-policy/tests/fixtures/port/interface_rules_corpus.ts]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { EXAIX_RULE_PACK } from "../src/rule_pack/mod.ts";
import { pluginRuleFindings } from "./helpers/script_port_parity.ts";
import { INTERFACE_RULES_CORPUS } from "./fixtures/port/interface_rules_corpus.ts";
import goldenJson from "./fixtures/port/interface_rules_golden.json" with { type: "json" };

type RuleLine = readonly [string, number];

interface ICorrection {
  readonly expected: readonly RuleLine[];
  readonly reason: string;
}

const SCRIPT_ID = "no-interface-rename-on-import";

/** Cases where the AST rule intentionally differs from the old line-based script. */
const CORRECTIONS: Readonly<Record<string, ICorrection>> = {
  "renamed specifier on its own line": {
    expected: [[SCRIPT_ID, 2]],
    reason: "The script read only the text after the opening brace on the import line. The AST reads every specifier.",
  },
};

const GoldenSchema = z.record(z.string(), z.array(z.tuple([z.string(), z.number()])));
const golden = GoldenSchema.parse(goldenJson);
const catalog = loadPolicyCatalog(catalogJson);

function normalize(pairs: readonly RuleLine[]): string {
  return JSON.stringify([...pairs].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]));
}

function pluginPairs(path: string, text: string): RuleLine[] {
  return pluginRuleFindings(SCRIPT_ID, catalog, { file: path, text }).map((
    finding,
  ): RuleLine => [SCRIPT_ID, finding.line]);
}

for (const unit of INTERFACE_RULES_CORPUS) {
  const correction = CORRECTIONS[unit.name];
  Deno.test(`interface rules parity: ${unit.name}`, () => {
    const actual = normalize(pluginPairs(unit.path, unit.text));
    const scriptSide = golden[unit.name];
    assertEquals(actual, normalize(correction?.expected ?? scriptSide));
  });
}

Deno.test("every recorded correction names a corpus case and differs from the script", () => {
  const names = new Set(INTERFACE_RULES_CORPUS.map((unit) => unit.name));
  for (const [name, correction] of Object.entries(CORRECTIONS)) {
    assertEquals(names.has(name), true, `unknown corpus case: ${name}`);
    const scriptSide = golden[name];
    assertEquals(
      normalize(scriptSide) === normalize(correction.expected),
      false,
      `correction equals the script result: ${name}`,
    );
  }
});

interface IInterfaceRuleEntry {
  readonly options?: { readonly prefix?: string };
}

Deno.test("the interface naming and rename rules take the same prefix in the Exaix catalog", () => {
  const rules = catalogJson.rules as Record<string, IInterfaceRuleEntry>;
  const naming = rules["exaix/exported-interface-naming"].options?.prefix;
  const rename = rules["exaix/no-interface-rename-on-import"].options?.prefix;
  assertEquals(typeof naming, "string");
  assertEquals(rename, naming);
});

Deno.test("the Exaix rule pack registers no rule and the catalog still parses", () => {
  assertEquals(Object.keys(EXAIX_RULE_PACK.rules), []);
  assertEquals(Object.keys(EXAIX_RULE_PACK.optionSchemas), []);
  assertEquals(catalog.rules["exaix/exported-interface-naming"].engine, "plugin");
});
