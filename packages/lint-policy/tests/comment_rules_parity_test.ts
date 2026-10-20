/**
 * @module CommentRulesParityTest
 * @path packages/lint-policy/tests/comment_rules_parity_test.ts
 * @description Checks that the plugin ports of the comment, parameter, fixture, header, and file-name rules match the old script findings, except for recorded AST corrections.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts, packages/lint-policy/tests/fixtures/port/comment_rules_corpus.ts]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { pluginRuleFindings } from "./helpers/script_port_parity.ts";
import { COMMENT_RULES_CORPUS } from "./fixtures/port/comment_rules_corpus.ts";
import goldenJson from "./fixtures/port/comment_rules_golden.json" with { type: "json" };

type RuleLine = readonly [string, number];

interface ICorrection {
  readonly expected: readonly RuleLine[];
  readonly reason: string;
}

/** The plugin key of each rule that the script reported, by the old script id. */
const PLUGIN_KEY_OF: Readonly<Record<string, string>> = {
  "max-params": "max-params",
  "long-comment": "long-comment",
  "ephemeral-comment": "ephemeral-comment",
  "decorative-comment": "decorative-comment",
  "ephemeral-filename": "ephemeral-filename",
  "test-inline-multiline-fixture": "test-inline-multiline-fixture",
  "module-header": "require-module-header",
  "script-usage": "require-script-usage",
};

/** Cases where the AST rule intentionally differs from the old line-based script. */
const CORRECTIONS: Readonly<Record<string, ICorrection>> = {
  "arrow with eight parameters": {
    expected: [["max-params", 1], ["module-header", 1]],
    reason:
      "The script counted only lines that look like a function signature. The AST counts every function-like node.",
  },
  "named template that holds escaped backticks": {
    expected: [["module-header", 1], ["test-inline-multiline-fixture", 1]],
    reason:
      "The script ended a template at the first line with a backtick, including an escaped one. The AST reads the whole template.",
  },
  "exported named template": {
    expected: [["module-header", 1], ["test-inline-multiline-fixture", 1]],
    reason:
      "The script matched only a line that starts with const, let, or var. The AST also reads an exported declaration.",
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
  for (const [scriptId, key] of Object.entries(PLUGIN_KEY_OF)) {
    for (const finding of pluginRuleFindings(key, catalog, { file: path, text })) pairs.push([scriptId, finding.line]);
  }
  return pairs;
}

for (const unit of COMMENT_RULES_CORPUS) {
  const correction = CORRECTIONS[unit.name];
  Deno.test(`comment rules parity: ${unit.name}`, () => {
    const actual = normalize(pluginPairs(unit.path, unit.text));
    const scriptSide = golden[unit.name];
    assertEquals(actual, normalize(correction?.expected ?? scriptSide));
  });
}

Deno.test("every recorded correction names a corpus case and differs from the script", () => {
  const names = new Set(COMMENT_RULES_CORPUS.map((unit) => unit.name));
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
