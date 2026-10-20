/**
 * @module CheckCodeStyleRulesTest
 * @path packages/lint-policy/tests/check_code_style_rules_test.ts
 * @description Named valid and invalid case per style rule id, grouped by tag.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts, packages/lint-policy/tests/check_code_style_catalog_parity_test.ts]
 */

import { assertEquals } from "@std/assert";
import { checkSource } from "../src/checkers/check_code_style.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";

const catalog = loadPolicyCatalog(catalogJson);
const ROOT = Deno.cwd();
const abs = (rel: string) => `${ROOT}/${rel}`;
const PROD = abs("packages/x/src/sample.ts");

interface IRuleCase {
  readonly id: string;
  readonly invalid: string;
  readonly valid: string;
  readonly path?: string;
}

const HEADER = "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n * @description Sample module.\n */\n";

const CASES: IRuleCase[] = [
  // module-structure
  {
    id: "module-header-tag",
    invalid: "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n */\nexport const a = 1;\n",
    valid: HEADER + "export const a = 1;\n",
  },

  // scripts
  {
    id: "script-placement",
    invalid:
      "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n * @path scripts/debug_sample.ts\n * @description d.\n *\n * Usage:\n *   deno run -A scripts/debug_sample.ts\n */\nexport const a = 1;\n",
    valid: "export const a = 1;\n",
    path: abs("scripts/debug_sample.ts"),
  },

  // edition
  {
    id: "edition-conditional-outside-composer",
    invalid: "export const s = edition === 'solo';\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "edition-leak",
    invalid: "import { X } from '@exaix-team/voting';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
  },

  // package
  {
    id: "package-boundary",
    invalid: "import { X } from '../../other/src/x.ts';\nexport const a = X;\n",
    valid: "import { X } from './sibling.ts';\nexport const a = X;\n",
  },
  {
    id: "package-related-files-boundary",
    invalid:
      "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n * @description d.\n * @related-files [src/services/core/db.ts]\n */\nexport const a = 1;\n",
    valid: HEADER + "export const a = 1;\n",
  },
  {
    id: "package-subpath-promotion",
    invalid: "export * from './src/status/mod.ts';\n",
    valid: "export const X = 1;\n",
    path: abs("packages/core/mod.ts"),
  },
  {
    id: "package-testing-import",
    invalid: "import { X } from '../../git/tests/helpers/constants.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/x/tests/sample_test.ts"),
  },
  {
    id: "package-canonical-import",
    invalid: "import { X } from '../../core/src/types/mod.ts';\nexport const a = X;\n",
    valid: "import { X } from '@exaix/core/types';\nexport const a = X;\n",
  },
  {
    id: "package-instantiates-event-logger",
    invalid: "export const a = new EventLogger('x');\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "package-concrete-logger-type",
    invalid: "import { EventLogger } from '@exaix/core/runtime';\nexport const a = EventLogger;\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "package-uses-config-reader",
    invalid: "export const a = new ConfigService();\n",
    valid: "export const a = 1;\n",
  },

  // test-quality

  // boundary
  {
    id: "concrete-cross-domain",
    invalid: "import { ExecutionLoop } from '@exaix/execution';\nexport const a = new ExecutionLoop();\n",
    valid: "export const a = 1;\n",
    path: abs("packages/flow/src/sample.ts"),
  },
  {
    id: "layer-constant-leak",
    invalid: "import { DEFAULT_MCP_TIMEOUT } from '@exaix/mcp';\nexport const a = DEFAULT_MCP_TIMEOUT;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/flow/src/sample.ts"),
  },
];

for (const testCase of CASES) {
  const path = testCase.path ?? PROD;
  Deno.test(`${testCase.id}: invalid case is reported`, () => {
    const findings = checkSource(path, testCase.invalid, catalog).filter((f) => f.rule === testCase.id);
    assertEquals(findings.length >= 1, true, `expected ${testCase.id} to fire on the invalid case`);
  });

  Deno.test(`${testCase.id}: valid case is not reported`, () => {
    const findings = checkSource(path, testCase.valid, catalog).filter((f) => f.rule === testCase.id);
    assertEquals(findings.length, 0, `expected ${testCase.id} not to fire on the valid case`);
  });
}

Deno.test("layer-constant-leak: a constant imported from the shared foundation package is not reported", () => {
  const source = "import { DEFAULT_RUNTIME_PATH } from '@exaix/shared';\nexport const a = DEFAULT_RUNTIME_PATH;\n";
  const findings = checkSource(abs("packages/flow/src/sample.ts"), source, catalog).filter((f) =>
    f.rule === "layer-constant-leak"
  );
  assertEquals(findings.length, 0);
});

// Whole-tree script rules have dedicated test files rather than a per-file case.
const WHOLE_TREE_RULE_IDS = new Set(["duplicate-constant", "duplicate-type"]);

Deno.test("every implemented script rule id has a named case", () => {
  const withCases = new Set(CASES.map((c) => c.id));
  const missing = [...Object.entries(catalog.rules)]
    .filter(([id, entry]) => entry.engine === "script" && !withCases.has(id) && !WHOLE_TREE_RULE_IDS.has(id))
    .map(([id]) => id);
  assertEquals(missing, []);
});
