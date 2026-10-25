/**
 * @module UnslopIsolationTest
 * @path packages/lint-policy/tests/unslop_isolation_test.ts
 * @description Named valid and invalid cases for the exaix/unslop-isolation plugin rule, its catalog entry, and the repository-wide zero-violation state.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/src/rule_pack/unslop_isolation.ts, packages/lint-policy/src/policy_config.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createDenoPlugin, runPlugin } from "@dostark/unslop-ts/deno";
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "../src/rule_packs.ts";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const RULE_ID = "exaix/unslop-isolation";
const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
/** Phase 233 Step 8 deletes these Phase 229 adapter modules and their catalog exclusions. */
const PHASE_229_ADAPTER = [
  "packages/execution/src/unslop_assets.ts",
  "packages/execution/src/unslop_budget.ts",
  "packages/execution/src/unslop_check_error.ts",
  "packages/execution/src/unslop_check_runner.ts",
  "packages/execution/src/unslop_check_types.ts",
  "packages/execution/src/unslop_findings.ts",
  "packages/execution/src/unslop_lint_process.ts",
  "packages/execution/src/unslop_settings.ts",
  "packages/execution/src/unslop_snapshot.ts",
  "packages/execution/src/unslop_source_snapshot.ts",
  "packages/execution/src/unslop_trust.ts",
];
const ENGINE_IMPORT = 'import { parseCatalog } from "@dostark/unslop-ts";\n';

/** Runs only the isolation rule of the real compiled policy on one source. */
function diagnosticsFor(file: string, source: string): { id: string; message: string }[] {
  const plugin = createDenoPlugin(EXAIX_PLUGIN_NAME, POLICY_CATALOG, {
    rulePacks: EXAIX_RULE_PACKS,
    selection: RULE_ID,
  });
  return runPlugin(plugin, file, source).filter((diagnostic) => diagnostic.id === RULE_ID);
}

Deno.test("unslop-isolation accepts unslop code inside lint-policy and plain Exaix modules", () => {
  const valid: readonly (readonly [string, string, string])[] = [
    ["an unslop module in lint-policy", "packages/lint-policy/src/verification/unslop_check_runner.ts", ""],
    ["an engine import in lint-policy", "packages/lint-policy/plugin.ts", ENGINE_IMPORT],
    ["a generic lint check module", "packages/execution/src/deno_lint_check.ts", 'import { join } from "@std/path";\n'],
    ["an unslop-named contract constant", "packages/core/src/types/constants.ts", 'export const UNSLOP_KIND = "u";\n'],
    ["an engine script", "scripts/build_unslop_portal_bundle.ts", ENGINE_IMPORT],
    ["an unslop test file", "packages/execution/tests/unslop_check_runner_test.ts", ENGINE_IMPORT],
    ["an unrelated module", "packages/execution/src/verification_runner.ts", 'import { join } from "@std/path";\n'],
  ];
  for (const [name, file, source] of valid) {
    assertEquals(diagnosticsFor(file, source), [], `expected no report for: ${name}`);
  }
});

Deno.test("unslop-isolation reports unslop modules and engine imports outside lint-policy", () => {
  const invalid: readonly (readonly [string, string, string, string])[] = [
    ["a new unslop module in execution", "packages/execution/src/unslop_adapter.ts", "", "must live in"],
    ["a capitalized unslop module", "apps/exactl/src/commands/UnslopView.ts", "", "must live in"],
    ["a named engine import", "packages/execution/src/a.ts", ENGINE_IMPORT, "@dostark/unslop-ts"],
    [
      "an engine re-export",
      "packages/core/src/a.ts",
      'export * from "@dostark/unslop-ts/deno";\n',
      "@dostark/unslop-ts/deno",
    ],
    ["a relative engine path", "apps/exactl/src/a.ts", 'import "../../../unslop-ts/mod.ts";\n', "unslop-ts/mod.ts"],
    [
      "a dynamic engine import",
      "packages/flow/src/a.ts",
      'export const load = () => import("@dostark/unslop-ts");\n',
      "@dostark/unslop-ts",
    ],
  ];
  for (const [name, file, source, detail] of invalid) {
    const found = diagnosticsFor(file, source);
    assertEquals(found.length, 1, `expected one report for: ${name}`);
    assertStringIncludes(found[0].message, detail, name);
    assertStringIncludes(found[0].message, "packages/lint-policy", name);
  }
});

Deno.test("the catalog declares unslop-isolation as a production error gate that exempts scripts", () => {
  const entry = POLICY_CATALOG.rules[RULE_ID];
  assertEquals(entry.engine, "plugin");
  assertEquals(entry.severity, "error");
  assertEquals(entry.scope, "prod");
  assertEquals(entry.exclude, ["scripts/**", ...PHASE_229_ADAPTER]);
});

Deno.test("no production module outside lint-policy is an unslop module or imports the engine", async () => {
  const listed = await new Deno.Command("git", { args: ["ls-files", "*.ts"], cwd: REPO_ROOT }).output();
  const files = new TextDecoder().decode(listed.stdout).split("\n").filter((file) => file.length > 0);
  const findings: string[] = [];
  for (const file of files) {
    const text = await Deno.readTextFile(`${REPO_ROOT}${file}`);
    if (!/unslop/i.test(file) && !text.includes("unslop-ts")) continue;
    for (const diagnostic of diagnosticsFor(file, text)) findings.push(`${file}: ${diagnostic.message}`);
  }
  assertEquals(findings, []);
});
