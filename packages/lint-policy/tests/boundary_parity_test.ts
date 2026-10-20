/**
 * @module BoundaryParityTest
 * @path packages/lint-policy/tests/boundary_parity_test.ts
 * @description Checks that the Exaix import-boundaries zones report what the old TUI, CLI, and package boundary script rules reported.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/tests/fixtures/port/boundary_rules_corpus.ts, packages/lint-policy/catalog.json]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import { createLintPlugin, runPlugin } from "@dostark/unslop-ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "../src/rule_packs.ts";
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { BOUNDARY_RULES_CORPUS } from "./fixtures/port/boundary_rules_corpus.ts";
import goldenJson from "./fixtures/port/boundary_rules_golden.json" with { type: "json" };

type ZoneLine = readonly [string, number];

interface ICorrection {
  readonly expected: readonly ZoneLine[];
  readonly reason: string;
}

const RULE_ID = `${EXAIX_PLUGIN_NAME}/import-boundaries`;
const ZONE_NAME = /^Boundary '([^']+)':/;
const LINE_SPLIT = /\r?\n/;
/** The old script rule that each zone replaced, when the zone id differs from the rule id. */
const ZONE_TO_SCRIPT_ID: Readonly<Record<string, string>> = { "tui-boundary-helpers-tests": "tui-boundary-helpers" };

/** Cases where the AST rule intentionally differs from the old line-based script. */
const CORRECTIONS: Readonly<Record<string, ICorrection>> = {
  "tui import of the cli over lines": {
    expected: [["tui-boundary-cli", 1]],
    reason: "The script needed the module path on the line of the import keyword. The AST reads the whole declaration.",
  },
  "tui re-export of the cli": {
    expected: [["tui-boundary-cli", 1]],
    reason: "The script matched only an import keyword. The AST treats a re-export from a module as an import.",
  },
  "tui import text in a comment": {
    expected: [],
    reason: "The script matched import text in a comment. The AST sees no import.",
  },
};

const GoldenSchema = z.record(z.string(), z.array(z.tuple([z.string(), z.number()])));
const golden = GoldenSchema.parse(goldenJson);
const catalog = loadPolicyCatalog(catalogJson);

function normalize(pairs: readonly ZoneLine[]): string {
  return JSON.stringify([...pairs].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]));
}

function pluginPairs(path: string, text: string): ZoneLine[] {
  const plugin = createLintPlugin(EXAIX_PLUGIN_NAME, catalog, {
    rulePacks: EXAIX_RULE_PACKS,
    selection: RULE_ID,
  });
  return runPlugin(plugin, path, text)
    .filter((diagnostic) => diagnostic.id === RULE_ID)
    .map((diagnostic): ZoneLine => {
      const zone = ZONE_NAME.exec(diagnostic.message)?.[1] ?? "";
      return [
        ZONE_TO_SCRIPT_ID[zone] ?? zone,
        text.slice(0, diagnostic.range[0]).split(LINE_SPLIT).length,
      ];
    });
}

for (const unit of BOUNDARY_RULES_CORPUS) {
  const correction = CORRECTIONS[unit.name];
  Deno.test(`boundary parity: ${unit.name}`, () => {
    const expected = correction?.expected ?? golden[unit.name];
    assertEquals(normalize(pluginPairs(unit.path, unit.text)), normalize(expected));
  });
}

Deno.test("every recorded correction names a corpus case and differs from the script", () => {
  const names = new Set(BOUNDARY_RULES_CORPUS.map((unit) => unit.name));
  for (const [name, correction] of Object.entries(CORRECTIONS)) {
    assertEquals(names.has(name), true, `unknown corpus case: ${name}`);
    assertEquals(normalize(golden[name]) === normalize(correction.expected), false, `no difference: ${name}`);
  }
});
