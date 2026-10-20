/**
 * @module ScriptPortParityHelperTest
 * @path packages/lint-policy/tests/script_port_parity_helper_test.ts
 * @description Checks that the parity helper reports a missing, an extra, and a one-sided file.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts]
 */

import { assertEquals } from "@std/assert";
import {
  compareFindings,
  partitionFiles,
  pluginRuleFindings,
  scriptRuleFindings,
} from "./helpers/script_port_parity.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";

const FILE = "packages/x/src/a.ts";

Deno.test("a script finding that the plugin side lacks is reported as missing", () => {
  const report = compareFindings([{ file: FILE, line: 3 }], []);
  assertEquals(report.missing, [{ file: FILE, line: 3 }]);
  assertEquals(report.extra, []);
});

Deno.test("a plugin finding that the script side lacks is reported as extra", () => {
  const report = compareFindings([], [{ file: FILE, line: 7 }]);
  assertEquals(report.extra, [{ file: FILE, line: 7 }]);
  assertEquals(report.missing, []);
});

Deno.test("equal finding sets give an empty report and the order does not matter", () => {
  const left = [{ file: FILE, line: 1 }, { file: "packages/y/src/b.ts", line: 2 }];
  const right = [{ file: "packages/y/src/b.ts", line: 2 }, { file: FILE, line: 1 }];
  assertEquals(compareFindings(left, right), { missing: [], extra: [] });
});

Deno.test("a file that only one side covers is listed as dropped surface", () => {
  const files = [FILE, "docs/guide.yaml", "scripts/tool.ts"];
  const covers = {
    script: (file: string) => file !== "scripts/none.ts",
    plugin: (file: string) => !file.startsWith("scripts/") && !file.endsWith(".yaml"),
  };
  const parts = partitionFiles(files, covers);
  assertEquals(parts.shared, [FILE]);
  assertEquals(parts.scriptOnly, ["docs/guide.yaml", "scripts/tool.ts"]);
  assertEquals(parts.pluginOnly, []);
});

Deno.test("the script side returns the findings of one rule with their lines", () => {
  const catalog = loadPolicyCatalog(catalogJson);
  const findings = scriptRuleFindings("edition-conditional-outside-composer", catalog, {
    file: FILE,
    text: "export const gated = edition === 'team';\n",
  });
  assertEquals(findings, [{ file: FILE, line: 1 }]);
});

Deno.test("the plugin side returns the findings of one plugin rule with their lines", () => {
  const catalog = loadPolicyCatalog(catalogJson);
  const findings = pluginRuleFindings("exported-interface-naming", catalog, {
    file: FILE,
    text: "export interface Foo {\n  a: number;\n}\n",
  });
  assertEquals(findings, [{ file: FILE, line: 1 }]);
});
