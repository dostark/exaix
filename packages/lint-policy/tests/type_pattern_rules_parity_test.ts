/**
 * @module TypePatternRulesParityTest
 * @path packages/lint-policy/tests/type_pattern_rules_parity_test.ts
 * @description Checks that the plugin ports of the four type-pattern rules match the old script findings, except for recorded AST corrections.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts, packages/lint-policy/tests/fixtures/port/type_pattern_rules_corpus.ts]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import catalogJson from "./fixtures/catalog_v1.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { pluginRuleFindings } from "./helpers/script_port_parity.ts";
import { TYPE_PATTERN_CORPUS } from "./fixtures/port/type_pattern_rules_corpus.ts";
import goldenJson from "./fixtures/port/type_pattern_rules_golden.json" with { type: "json" };

type RuleLine = readonly [string, number];

interface ICorrection {
  readonly expected: readonly RuleLine[];
  readonly reason: string;
}

const PORTED_KEYS = [
  "promise-response-alias",
  "promise-response-return",
  "ts-suppression-pragmas",
  "magic-union-type",
] as const;

/** Cases where the AST rule intentionally differs from the old line-based script. */
const CORRECTIONS: Readonly<Record<string, ICorrection>> = {
  "alias spread over two lines": {
    expected: [["promise-response-alias", 1]],
    reason:
      "The script read one line at a time and missed an alias that spans lines. The AST reads the whole declaration.",
  },
  "function type returning the weak promise as a parameter": {
    expected: [["promise-response-return", 1]],
    reason:
      "The script needed a colon before the type. The AST also reports the return type of a function type that is not an alias body.",
  },
  "weak promise in a comment": {
    expected: [],
    reason: "The script matched text in a comment or string. The AST sees no type.",
  },
  "weak promise in a string": {
    expected: [],
    reason: "The script matched text in a comment or string. The AST sees no type.",
  },
  "return type split over two lines": {
    expected: [["promise-response-return", 2]],
    reason: "The script missed a return type that starts on the next line. The AST reads the annotation.",
  },
  "ignore without a description": {
    expected: [],
    reason:
      "A pragma without a description is the case of the built-in ban-ts-comment rule. The port keeps only the described case.",
  },
  "ignore with an empty description after a colon": {
    expected: [],
    reason:
      "A pragma without a description is the case of the built-in ban-ts-comment rule. The port keeps only the described case.",
  },
  "block comment ignore without a description": {
    expected: [],
    reason:
      "A pragma without a description is the case of the built-in ban-ts-comment rule. The port keeps only the described case.",
  },
  "pragma name in prose": {
    expected: [],
    reason:
      "The script matched the pragma name anywhere in a line. The AST rule needs the pragma at the start of a comment.",
  },
  "pragma name in a string": {
    expected: [],
    reason: "The script matched text in a comment or string. The AST sees no type.",
  },
  "string union with a dash in a value": {
    expected: [["magic-union-type", 1]],
    reason: "The script matched only word characters in a value. The AST sees every string literal in the union.",
  },
  "string union split over lines": {
    expected: [["magic-union-type", 2]],
    reason: "The script read one line at a time and missed a union that spans lines.",
  },
  "string union in a comment": {
    expected: [],
    reason: "The script matched text in a comment or string. The AST sees no type.",
  },
  "string union in a string": {
    expected: [],
    reason: "The script matched text in a comment or string. The AST sees no type.",
  },
  "alias of an object with a string union member on one line": {
    expected: [["magic-union-type", 1]],
    reason:
      "The script skipped any line that starts with type. The AST exempts only a union that is the whole alias body.",
  },
  "alias of an array of a string union": {
    expected: [["magic-union-type", 1]],
    reason:
      "The script skipped any line that starts with type. The AST exempts only a union that is the whole alias body.",
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

for (const unit of TYPE_PATTERN_CORPUS) {
  const correction = CORRECTIONS[unit.name];
  Deno.test(`type pattern rules parity: ${unit.name}`, () => {
    const actual = normalize(pluginPairs(unit.path, unit.text));
    const scriptSide = golden[unit.name];
    assertEquals(actual, normalize(correction?.expected ?? scriptSide));
  });
}

Deno.test("every recorded correction names a corpus case and differs from the script", () => {
  const names = new Set(TYPE_PATTERN_CORPUS.map((unit) => unit.name));
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
