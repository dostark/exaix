/**
 * @module ComplexityCutoverTest
 * @path packages/lint-policy/tests/complexity_cutover_test.ts
 * @description Proves the extended parent pin, the three-rule ceiling gate and the normal-lint split.
 * @architectural-layer Test
 * @dependencies [@std/assert, @dostark/unslop-ts]
 * @related-files [../../../unslop.config.json, ./fixtures/catalog_v1.json, ../src/policy_config.ts]
 */

import type { JSONObject } from "@exaix/core";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type ICatalog, type JsonValue, parseCatalog } from "@dostark/unslop-ts";
import { createDenoPlugin, runPlugin } from "@dostark/unslop-ts/deno";
import { EXAIX_REGISTRY, EXAIX_RULE_PACKS } from "../src/rule_packs.ts";
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { POLICY_CATALOG, POLICY_COMPILED } from "../src/policy_config.ts";
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import catalogFixture from "./fixtures/catalog_v1.json" with { type: "json" };

const REPO_ROOT = new URL("../../../", import.meta.url);
const ENGINE_MODULE = new URL("./unslop-ts/mod.ts", REPO_ROOT).href;
const REPORTER = new URL("./unslop-ts/src/cli/rule_report.ts", REPO_ROOT).href;
const RULE_ID = `${EXAIX_PLUGIN_NAME}/max-cyclomatic-complexity`;
const FIXTURE_PATH = "packages/x/src/wide.ts";
const PARENT_LIMIT = 15;
const NULLISH_DECISIONS = 16;
const NULLISH_EXTENDED = 1 + NULLISH_DECISIONS;
const THREE_RULES = [
  "demo/max-cyclomatic-complexity",
  "demo/max-cognitive-complexity",
  "demo/max-function-lines",
];

/** A function whose switch cases cross the cyclomatic limit with a low cognitive count. */
function wideSource(name = "wide"): string {
  const lines = [`export function ${name}(value: number): number {`, "  switch (value) {"];
  for (let index = 0; index < 16; index++) {
    lines.push(`    case ${index}:`, `      return ${index};`);
  }
  lines.push("    default:", "      return -1;", "  }", "}");
  return `${lines.join("\n")}\n`;
}

/** A function whose cognitive nesting passes the limit while its cyclomatic count stays low. */
function deepSource(): string {
  const lines = ["export function deep(a: boolean, b: boolean): number {"];
  lines.push("  if (a) {");
  lines.push("    if (b) {");
  lines.push("      if (a && b) {");
  lines.push("        if (!a) {");
  lines.push("          if (b) {");
  lines.push("            if (a || b) {");
  lines.push("              return 1;");
  for (let index = 0; index < 6; index++) lines.push("            }");
  lines.push("  return 0;");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** A function whose line count passes the limit with no branches. */
function longSource(): string {
  const lines = ["export function long(): number {", "  let total = 0;"];
  for (let index = 0; index < 62; index++) lines.push(`  total += ${index};`);
  lines.push("  return total;");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** A function that crosses every one of the three limits. */
function mixedSource(): string {
  const lines = ["export function mixed(value: number): number {", "  switch (value) {"];
  for (let index = 0; index < 16; index++) lines.push(`    case ${index}:`, `      break;`);
  lines.push("    default:", "      break;", "  }");
  lines.push("  let total = 0;");
  for (let index = 0; index < 6; index++) lines.push(`  if (value > ${index}) {`);
  for (let index = 0; index < 40; index++) lines.push(`    total += ${index};`);
  for (let index = 0; index < 6; index++) lines.push("  }");
  lines.push("  return total;", "}");
  return `${lines.join("\n")}\n`;
}

/** Runs Deno in one directory and returns its output. */
async function runDeno(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

/** The version 2 catalog with the three complexity rules. */
function cutoverCatalog(): JSONObject {
  return {
    version: 2,
    plugin: "demo",
    extends: [],
    docsBase: "docs/",
    paths: { test: ["**/*_test.ts"], fixture: ["**/fixtures/**"], ignore: [] },
    rules: {
      "demo/max-cyclomatic-complexity": { level: "error", options: { max: 15, variant: "extended" } },
      "demo/max-cognitive-complexity": { level: "error", options: { max: 15, countNullish: true } },
      "demo/max-function-lines": { level: "error", options: { max: 60 } },
    },
  };
}

/** The descriptor of the isolated cutover fixture. */
const DESCRIPTOR = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
`;

/** The plugin entry of the isolated cutover fixture. */
const PLUGIN = `import { createUnslopProject } from "@dostark/unslop-ts/deno";
import { descriptor } from "./unslop.project.ts";
import config from "./unslop.config.json" with { type: "json" };

export default createUnslopProject({ descriptor, config }).plugin;
`;

/** Writes the isolated cutover fixture to a temp dir and runs `body` in it. */
async function withCutoverProject(
  body: (dir: string) => Promise<void>,
  options: { readonly plugin: boolean } = { plugin: true },
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "complexity_cutover_" });
  try {
    await Deno.mkdir(join(dir, "packages/x/src"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        imports: { "@dostark/unslop-ts": ENGINE_MODULE },
        lint: options.plugin ? { plugins: ["./plugin.ts"] } : {},
      }),
    );
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), JSON.stringify(cutoverCatalog(), null, 2));
    await Deno.writeTextFile(join(dir, "plugin.ts"), PLUGIN);
    await Deno.writeTextFile(
      join(dir, "rule_ceilings.json"),
      JSON.stringify(Object.fromEntries(THREE_RULES.map((rule) => [rule, { ".": 0 }]))),
    );
    await Deno.writeTextFile(join(dir, "packages/x/src/wide.ts"), wideSource());
    await Deno.writeTextFile(join(dir, "packages/x/src/deep.ts"), deepSource());
    await Deno.writeTextFile(join(dir, "packages/x/src/long.ts"), longSource());
    await Deno.writeTextFile(join(dir, "packages/x/src/mixed.ts"), mixedSource());
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the ceiling reporter for one rule in the fixture. */
async function reportRule(
  dir: string,
  rule: string,
  ceilings = "rule_ceilings.json",
): Promise<{ code: number; over: readonly { packageName: string; rule: string; count: number }[] }> {
  const result = await runDeno([
    "run",
    "-A",
    REPORTER,
    `--rule=${rule}`,
    "--roots=packages",
    "--descriptor=unslop.project.ts",
    `--ceilings=${ceilings}`,
    "--json",
    "--fail",
  ], dir);
  assert(result.stdout.length > 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    ceilings: { over: readonly { packageName: string; rule: string; count: number }[] };
  };
  return { code: result.code, over: report.ceilings.over };
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

Deno.test("extended-parent-transition: the parent catalog pins the extended variant in every copy", () => {
  const entry = POLICY_CATALOG.rules[RULE_ID];
  assert(entry !== undefined, RULE_ID);
  assertEquals(entry.options?.variant, "extended");
  assertEquals(POLICY_COMPILED.rules[RULE_ID].effectiveOptions?.variant, "extended");
  const fixture = loadPolicyCatalog(catalogFixture as JsonValue);
  assertEquals(fixture.rules[RULE_ID].options?.variant, "extended");
});

Deno.test("extended-parent-transition: the parent gate and a default engine fixture both count extended", () => {
  const source = wideSource();
  const defaults = cyclomaticMessages(defaultVariantCatalog(), source);
  assertEquals(defaults.length, 1);
  assert(defaults[0].includes(`${NULLISH_EXTENDED} (limit ${PARENT_LIMIT})`), defaults[0]);
  assertEquals(cyclomaticMessages(POLICY_CATALOG, source).length, 1);
});

Deno.test("check-complexity-cutover: each seeded function exceeds only its rule and package", async () => {
  await withCutoverProject(async (dir) => {
    const cyclomatic = await reportRule(dir, "demo/max-cyclomatic-complexity");
    assertEquals(cyclomatic.code, 1);
    assertEquals(cyclomatic.over.length, 1);
    assertEquals(cyclomatic.over[0].count, 2);
    const cognitive = await reportRule(dir, "demo/max-cognitive-complexity");
    assertEquals(cognitive.code, 1);
    assertEquals(cognitive.over.length, 1);
    assertEquals(cognitive.over[0].count, 2);
    const size = await reportRule(dir, "demo/max-function-lines");
    assertEquals(size.code, 1);
    assertEquals(size.over.length, 1);
    assertEquals(size.over[0].count, 2);
    assertEquals(cyclomatic.over[0].packageName, ".");
  });
});

Deno.test("complexity-host-completeness: all three gates refuse an unobserved plugin and keep the ceiling behavior", async () => {
  await withCutoverProject(async (dir) => {
    for (const rule of THREE_RULES) {
      const result = await runDeno([
        "run",
        "-A",
        REPORTER,
        `--rule=${rule}`,
        "--roots=packages",
        "--descriptor=unslop.project.ts",
        "--ceilings=rule_ceilings.json",
        "--json",
        "--fail",
      ], dir);
      assert(result.code !== 0, `${rule} passed without its plugin`);
      assert(result.stderr.includes("reported no observation"), result.stderr);
      assertEquals(result.stdout, "");
    }
  }, { plugin: false });
  await withCutoverProject(async (dir) => {
    for (const rule of THREE_RULES) assertEquals((await reportRule(dir, rule)).code, 1, rule);
  });
});

Deno.test("normal-lint-ratchet-cutover: ordinary lint passes, the gate passes at the ceiling and fails over", async () => {
  await withCutoverProject(async (dir) => {
    const excluded = await runDeno([
      "lint",
      "--json",
      "packages",
      `--rules-exclude=${THREE_RULES.join(",")}`,
    ], dir);
    assertEquals(excluded.code, 0, excluded.stderr);

    const editor = await runDeno(["lint", "--json", "packages"], dir);
    assert(editor.code !== 0, "an unexcluded invocation must report the complexity rules");
    const codes = new Set(
      (JSON.parse(editor.stdout) as { diagnostics: { code?: string }[] }).diagnostics.map((entry) => entry.code),
    );
    for (const rule of THREE_RULES) assert(codes.has(rule), rule);

    const atCeiling = Object.fromEntries(THREE_RULES.map((rule) => [rule, { ".": 2 }]));
    await Deno.writeTextFile(join(dir, "rule_ceilings.json"), JSON.stringify(atCeiling));
    assertEquals((await reportRule(dir, "demo/max-cyclomatic-complexity")).code, 0);

    await Deno.writeTextFile(join(dir, "packages/x/src/wide2.ts"), wideSource("wide2"));
    const over = await reportRule(dir, "demo/max-cyclomatic-complexity");
    assertEquals(over.code, 1);
    assertEquals(over.over.length, 1);
    assertEquals(over.over[0].count, 3);
    assertEquals(over.over[0].packageName, ".");
  });
});

Deno.test("health-task-run: the declared health task reaches the full report", async () => {
  // The tree is shared with tests that write a scratch file, so one rerun absorbs a file that vanished mid-scan.
  let result = await runDeno(["task", "health"], REPO_ROOT.pathname);
  if (result.code !== 0) result = await runDeno(["task", "health"], REPO_ROOT.pathname);
  assertEquals(result.code, 0, result.stderr.slice(-2000));
  for (const marker of ["UNSLOP HEALTH", "Score ", "Coverage    none", "Graph", "SCORE SIGNALS", "HOTSPOTS"]) {
    assert(result.stdout.includes(marker), marker);
  }
});
