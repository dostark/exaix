/**
 * @module ImportRulesParityTest
 * @path packages/lint-policy/tests/import_rules_parity_test.ts
 * @description Checks that the plugin ports of the six import and placement rules match the old script findings, except for recorded AST corrections.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts, packages/lint-policy/tests/fixtures/port/import_rules_corpus.ts]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { pluginRuleFindings } from "./helpers/script_port_parity.ts";
import { IMPORT_RULES_CORPUS } from "./fixtures/port/import_rules_corpus.ts";
import goldenJson from "./fixtures/port/import_rules_golden.json" with { type: "json" };

type RuleLine = readonly [string, number];

interface ICorrection {
  readonly expected: readonly RuleLine[];
  readonly reason: string;
}

const PORTED_KEYS = [
  "import-inside-statement",
  "dynamic-import",
  "inline-type-import",
  "re-export-imported",
  "import-placement",
  "exported-interface-placement",
] as const;

/** Cases where the AST rule intentionally differs from the old line-based script. */
const CORRECTIONS: Readonly<Record<string, ICorrection>> = {
  "import call in an indented string": {
    expected: [],
    reason: "The script flagged import( text inside string literals. The AST sees no import call.",
  },
  "one-line arrow import": {
    expected: [["dynamic-import", 1], ["import-inside-statement", 1]],
    reason: "The script missed an import call inside a one-line arrow body. The AST finds the call.",
  },
  "indented await import in a top-level array": {
    expected: [["dynamic-import", 2]],
    reason: "The script took indentation as nesting. The array element is not inside a function or block.",
  },
  "style-exclude comment above a dynamic import": {
    expected: [["dynamic-import", 2]],
    reason: "The style-exclude comment form is retired. Only a deno-lint-ignore comment suppresses the rule.",
  },
  "import type in a parameter": {
    expected: [["inline-type-import", 1]],
    reason: "The script flagged a type-position import( as a dynamic import. The AST separates types from calls.",
  },
  "import type without a member": {
    expected: [],
    reason: "The script flagged a type-position import( as a dynamic import. The AST separates types from calls.",
  },
  "import type in a type argument": {
    expected: [["inline-type-import", 1]],
    reason: "The script flagged a type-position import( as a dynamic import. The AST separates types from calls.",
  },
  "import type in a comment": {
    expected: [],
    reason: "The script flagged text in a comment. The AST ignores comments.",
  },
  "string that contains the word from": {
    expected: [],
    reason: "The script flagged the word from inside a string literal. The AST sees no export source.",
  },
  "multi-line export list of imported names": {
    expected: [["re-export-imported", 2], ["re-export-imported", 2]],
    reason: "The script missed export lists that span lines. The AST reports one finding per exported imported name.",
  },
};

const GoldenSchema = z.record(z.string(), z.array(z.tuple([z.string(), z.number()])));
const golden = GoldenSchema.parse(goldenJson);
const catalog = loadPolicyCatalog(catalogJson);

function normalize(pairs: readonly RuleLine[]): string {
  return JSON.stringify([...pairs].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]));
}

function pluginPairs(path: string, text: string): RuleLine[] {
  const pairs: RuleLine[] = [];
  for (const key of PORTED_KEYS) {
    for (const finding of pluginRuleFindings(key, catalog, { file: path, text })) pairs.push([key, finding.line]);
  }
  return pairs;
}

for (const unit of IMPORT_RULES_CORPUS) {
  const correction = CORRECTIONS[unit.name];
  Deno.test(`import rules parity: ${unit.name}`, () => {
    const actual = normalize(pluginPairs(unit.path, unit.text));
    const scriptSide = golden[unit.name];
    assertEquals(actual, normalize(correction?.expected ?? scriptSide));
  });
}

Deno.test("every recorded correction names a corpus case and differs from the script", () => {
  const names = new Set(IMPORT_RULES_CORPUS.map((unit) => unit.name));
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
