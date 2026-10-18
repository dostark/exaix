/**
 * @module LintPolicyMoveEquivalenceTest
 * @path tests/scripts/lint_policy_move_equivalence_test.ts
 * @description Proves that all Exaix lint policy lives in packages/lint-policy, that the engine
 *   package holds no Exaix code, and that the moved style checkers still run through their tasks.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/fs, @std/path, @exaix/lint-rules, @exaix/lint-policy]
 * @related-files [packages/lint-policy/mod.ts, packages/lint-rules/mod.ts]
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { createLintPlugin, parseCatalog, runPlugin } from "@exaix/lint-rules";
import { EXAIX_PLUGIN_NAME } from "@exaix/lint-policy/rule_pack/mod.ts";
import { EXAIX_REGISTRY, EXAIX_RULE_PACKS } from "@exaix/lint-policy/rule_packs.ts";
import catalogJson from "@exaix/lint-policy/catalog.json" with { type: "json" };

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const POLICY_ROOT = "packages/lint-policy";
const ENGINE_ROOT = "packages/lint-rules";
const POLICY_FILES: readonly string[] = [
  `${POLICY_ROOT}/deno.json`,
  `${POLICY_ROOT}/mod.ts`,
  `${POLICY_ROOT}/README.md`,
  `${POLICY_ROOT}/catalog.json`,
  `${POLICY_ROOT}/plugin.ts`,
  `${POLICY_ROOT}/rule_ceilings.json`,
  `${POLICY_ROOT}/src/checkers/check_code_style.ts`,
  `${POLICY_ROOT}/src/checkers/check_magic_values.ts`,
  `${POLICY_ROOT}/src/repo_layout.ts`,
  `${POLICY_ROOT}/docs/style_rules.md`,
  `${POLICY_ROOT}/docs/style_guide.md`,
];
const POLICY_TESTS: readonly string[] = [
  "check_code_style_test.ts",
  "check_code_style_rules_test.ts",
  "check_code_style_rules_options_test.ts",
  "check_code_style_catalog_parity_test.ts",
  "check_code_style_catalog_equivalence_test.ts",
  "check_code_style_catalog_validation_test.ts",
  "check_code_style_tags_test.ts",
  "check_edition_leak_import_test.ts",
  "check_prod_tests_import_test.ts",
];
const OLD_SCRIPT_CONFIG_FILES: readonly string[] = [
  "scripts/config/style_rule_catalog.json",
  "scripts/config/exaix_lint_plugin.ts",
  "scripts/config/rule_ceilings.json",
];
const EXAIX_ENGINE_TOKENS: readonly string[] = ["src/exaix", "check_code_style", "EDITION_TIERS"];
const TEXT_EXTENSIONS: readonly string[] = [".ts", ".md", ".json"];

async function exists(repoRelativePath: string): Promise<boolean> {
  try {
    await Deno.stat(join(REPO_ROOT, repoRelativePath));
    return true;
  } catch {
    return false;
  }
}

async function readRepoJson(repoRelativePath: string): Promise<{ [key: string]: unknown }> {
  return JSON.parse(await Deno.readTextFile(join(REPO_ROOT, repoRelativePath)));
}

async function runTask(task: string, args: readonly string[]): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", task, ...args],
    cwd: REPO_ROOT,
    env: Deno.env.toObject(),
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const decoder = new TextDecoder();
  return { code: result.code, output: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

/** Runs `body` with a throwaway directory that holds a `packages/demo/src` tree, then removes it. */
async function withDemoRoot<T>(body: (root: string, srcDir: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir();
  const srcDir = join(root, "packages", "demo", "src");
  await Deno.mkdir(srcDir, { recursive: true });
  try {
    return await body(root, srcDir);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("lint-policy holds the catalog, plugin entry, ceilings, checkers, layout, and docs", async () => {
  for (const file of POLICY_FILES) {
    assert(await exists(file), `${file} must exist`);
  }
});

Deno.test("lint-policy holds the nine Exaix test files and the style checker fixtures", async () => {
  for (const name of POLICY_TESTS) {
    assert(await exists(`${POLICY_ROOT}/tests/${name}`), `${name} must live in lint-policy`);
    assertFalse(await exists(`${ENGINE_ROOT}/tests/${name}`), `${name} must leave the engine package`);
  }
  assert(await exists(`${POLICY_ROOT}/tests/fixtures/check_code_style_test/markdown.md`));
});

Deno.test("scripts/config no longer holds the moved policy files", async () => {
  for (const file of OLD_SCRIPT_CONFIG_FILES) {
    assertFalse(await exists(file), `${file} must move into lint-policy`);
  }
});

Deno.test("the engine package holds no Exaix checker code", async () => {
  assertFalse(await exists(`${ENGINE_ROOT}/src/exaix`), "src/exaix must be gone");
  const offenders: string[] = [];
  for await (const entry of walk(join(REPO_ROOT, ENGINE_ROOT), { includeDirs: false, exts: [...TEXT_EXTENSIONS] })) {
    const text = await Deno.readTextFile(entry.path);
    const token = EXAIX_ENGINE_TOKENS.find((candidate) => text.includes(candidate));
    if (token) offenders.push(`${relative(REPO_ROOT, entry.path)} names ${token}`);
  }
  assertEquals(offenders, []);
});

Deno.test("the root deno.json registers lint-policy and points the gates at it", async () => {
  const config = await readRepoJson("deno.json");
  const workspace = config.workspace as string[];
  const imports = config.imports as { [alias: string]: string };
  const lint = config.lint as { plugins: string[] };
  const tasks = config.tasks as { [name: string]: string };
  assert(workspace.includes(`./${POLICY_ROOT}`));
  assertEquals(imports["@exaix/lint-policy"], `./${POLICY_ROOT}/mod.ts`);
  assertEquals(imports["@exaix/lint-policy/"], `./${POLICY_ROOT}/src/`);
  assertEquals(imports["@exaix/lint-policy/catalog.json"], `./${POLICY_ROOT}/catalog.json`);
  assertEquals(lint.plugins, [`./${POLICY_ROOT}/plugin.ts`]);
  assertStringIncludes(tasks["check:style"], `${POLICY_ROOT}/src/checkers/check_code_style.ts`);
  assertStringIncludes(tasks["check:magic"], `${POLICY_ROOT}/src/checkers/check_magic_values.ts`);
  assertStringIncludes(tasks["docs:style-rules"], `${POLICY_ROOT}/docs/style_rules.md`);
});

Deno.test("lint-policy exports the edition tier helpers and the engine package does not", async () => {
  const policyEntry = await Deno.readTextFile(join(REPO_ROOT, POLICY_ROOT, "mod.ts"));
  assertStringIncludes(policyEntry, "EDITION_TIERS");
  assertStringIncludes(policyEntry, "editionTierOfPath");
  const engineEntry = await Deno.readTextFile(join(REPO_ROOT, ENGINE_ROOT, "mod.ts"));
  assertFalse(engineEntry.includes("EDITION_TIERS"));
  assertFalse(engineEntry.includes("editionTierOfPath"));
});

const CLEAN_MODULE = [
  "/**",
  " * @module TempClean",
  " * @path packages/demo/src/clean.ts",
  " * @description Temporary clean module.",
  " */",
  "",
  "export const value = 1;",
  "",
].join("\n");

const PRAGMA_MODULE = [
  "/**",
  " * @module TempPragma",
  " * @path packages/demo/src/pragma.ts",
  " * @description Temporary module with a suppression pragma.",
  " */",
  "",
  "// @ts-" + "expect-error temporary violation",
  'export const value: number = "text";',
  "",
].join("\n");

const REPEATED_LITERAL = "repeated-literal-value";

Deno.test("the check:style task runs the moved checker and reports a clean module", async () => {
  await withDemoRoot(async (_root, srcDir) => {
    const file = join(srcDir, "clean.ts");
    await Deno.writeTextFile(file, CLEAN_MODULE);
    const result = await runTask("check:style", [file]);
    assertEquals(result.code, 0, result.output);
    assertStringIncludes(result.output, "0 error(s)");
  });
});

Deno.test("the check:style task reports a violation through the catalog in lint-policy", async () => {
  await withDemoRoot(async (_root, srcDir) => {
    const file = join(srcDir, "pragma.ts");
    await Deno.writeTextFile(file, PRAGMA_MODULE);
    const result = await runTask("check:style", [file]);
    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[ts-suppression-pragmas]");
  });
});

Deno.test("the check:magic task runs the moved checker on a demo root", async () => {
  await withDemoRoot(async (root, srcDir) => {
    await Deno.writeTextFile(join(srcDir, "clean.ts"), "export const a = 1;\n");
    const result = await runTask("check:magic", [`--root=${root}`]);
    assertStringIncludes(result.output, "No magic value violations detected");
    assertFalse(result.output.includes(REPEATED_LITERAL));
  });
});

Deno.test("the check:magic task reports a repeated literal through the layout in lint-policy", async () => {
  await withDemoRoot(async (root, srcDir) => {
    const lines = Array.from({ length: 6 }, () => `  "${REPEATED_LITERAL}",`);
    await Deno.writeTextFile(join(srcDir, "repeat.ts"), ["export const list = [", ...lines, "];", ""].join("\n"));
    const result = await runTask("check:magic", [`--root=${root}`]);
    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, REPEATED_LITERAL);
  });
});

const SELECTION_VARIABLE = "EXAIX_LINT_RULES";
const FORBIDDEN_IGNORE_ID = `${EXAIX_PLUGIN_NAME}/no-forbidden-lint-ignore`;
const SHEBANG_ID = `${EXAIX_PLUGIN_NAME}/require-deno-shebang`;
const PROD_PATH = "packages/x/src/a.ts";
const SCRIPT_PATH = "scripts/x.ts";
const SCENARIO_SCRIPT_PATH = "tests/scenario_framework/scripts/x.ts";
const DENO_SHEBANG = "#!/usr/bin/env -S deno run -A";
const SCRIPT_HEADER =
  "/**\n * @module M\n * @path scripts/x.ts\n * @description d.\n *\n * Usage:\n *   deno run -A scripts/x.ts\n */\n";
const IGNORE_ANY = "// deno-lint-ignore no-explicit-any";

interface IParityCase {
  readonly name: string;
  readonly ruleId: string;
  readonly path: string;
  readonly source: string;
  /** Lines the deleted script rule reported, captured from the checker before it was removed. */
  readonly oldLines: readonly number[];
  /** Lines the plugin rule reports. */
  readonly nowLines: readonly number[];
  /** True when the deleted rule reported a line that is not a violation. */
  readonly oldFalsePositive?: boolean;
}

const IGNORE_CASES: readonly IParityCase[] = [
  ["line ignore", `export const a = 1;\n${IGNORE_ANY}\nexport const b: any = 1;\n`, [2], [2]],
  [
    "no space after slashes",
    "export const a = 1;\n//deno-lint-ignore no-explicit-any\nexport const b: any = 1;\n",
    [2],
    [2],
  ],
  ["with reason", `export const a = 1;\n${IGNORE_ANY} -- legacy\nexport const b: any = 1;\n`, [2], [2]],
  ["other rule only", "export const a = 1;\n// deno-lint-ignore no-unused-vars\nexport const b = 1;\n", [], []],
  ["forbidden id first", `export const a = 1;\n${IGNORE_ANY} no-unused-vars\nexport const b: any = 1;\n`, [2], [2]],
  ["file ignore", "// deno-lint-ignore-file no-explicit-any\nexport const b: any = 1;\n", [], []],
  ["template literal", `export const s = \`\n${IGNORE_ANY}\n\`;\n`, [], []],
  ["block comment", "export const a = 1;\n/* deno-lint-ignore no-explicit-any */\nexport const b: any = 1;\n", [], []],
  ["trailing comment", `export const b: any = 1; ${IGNORE_ANY}\n`, [1], [1]],
].map(([name, source, oldLines, nowLines]) => ({
  name: String(name),
  ruleId: FORBIDDEN_IGNORE_ID,
  path: PROD_PATH,
  source: String(source),
  oldLines: oldLines as number[],
  nowLines: nowLines as number[],
}));

const IGNORE_DIFFERENCES: readonly IParityCase[] = [
  {
    name: "forbidden id second: the plugin rule reads every id",
    ruleId: FORBIDDEN_IGNORE_ID,
    path: PROD_PATH,
    source: "export const a = 1;\n// deno-lint-ignore no-unused-vars no-explicit-any\nexport const b: any = 1;\n",
    oldLines: [],
    nowLines: [2],
  },
  {
    name: "string literal: the regex matched text that is not a comment",
    ruleId: FORBIDDEN_IGNORE_ID,
    path: PROD_PATH,
    source: `export const s = "${IGNORE_ANY}";\n`,
    oldLines: [1],
    nowLines: [],
    oldFalsePositive: true,
  },
  {
    name: "longer rule name: the regex matched a prefix of no-explicit-anything",
    ruleId: FORBIDDEN_IGNORE_ID,
    path: PROD_PATH,
    source: "export const a = 1;\n// deno-lint-ignore no-explicit-anything\nexport const b = 1;\n",
    oldLines: [2],
    nowLines: [],
    oldFalsePositive: true,
  },
];

const SHEBANG_CASES: readonly IParityCase[] = [
  ["exact shebang", SCRIPT_PATH, `${DENO_SHEBANG}\n${SCRIPT_HEADER}export const a = 1;\n`, [], []],
  [
    "shebang with trailing flags",
    SCRIPT_PATH,
    `${DENO_SHEBANG} --unstable\n${SCRIPT_HEADER}export const a = 1;\n`,
    [],
    [],
  ],
  ["missing shebang", SCRIPT_PATH, `${SCRIPT_HEADER}export const a = 1;\n`, [1], [1]],
  ["different shebang", SCRIPT_PATH, `#!/usr/bin/env deno run\n${SCRIPT_HEADER}export const a = 1;\n`, [1], [1]],
  ["missing shebang outside scripts", PROD_PATH, `${SCRIPT_HEADER}export const a = 1;\n`, [], []],
  [
    "missing shebang in the scenario framework scripts",
    SCENARIO_SCRIPT_PATH,
    `${SCRIPT_HEADER}export const a = 1;\n`,
    [],
    [],
  ],
].map(([name, path, source, oldLines, nowLines]) => ({
  name: String(name),
  ruleId: SHEBANG_ID,
  path: String(path),
  source: String(source),
  oldLines: oldLines as number[],
  nowLines: nowLines as number[],
}));

const SHEBANG_DIFFERENCES: readonly IParityCase[] = [
  {
    name: "empty file: the checker skipped it, and a script must still start with the shebang",
    ruleId: SHEBANG_ID,
    path: SCRIPT_PATH,
    source: "",
    oldLines: [],
    nowLines: [1],
  },
];

const PARITY_CASES: readonly IParityCase[] = [
  ...IGNORE_CASES,
  ...IGNORE_DIFFERENCES,
  ...SHEBANG_CASES,
  ...SHEBANG_DIFFERENCES,
];

/** Lines the real Exaix plugin reports for one rule on one source, with the selection variable cleared. */
function pluginLines(testCase: IParityCase): number[] {
  const previous = Deno.env.get(SELECTION_VARIABLE) ?? null;
  try {
    Deno.env.delete(SELECTION_VARIABLE);
    const catalog = parseCatalog(catalogJson, { scriptRuleSchemas: null, registry: EXAIX_REGISTRY });
    const plugin = createLintPlugin(EXAIX_PLUGIN_NAME, catalog, { rulePacks: EXAIX_RULE_PACKS });
    return runPlugin(plugin, testCase.path, testCase.source)
      .filter((diagnostic) => diagnostic.id === testCase.ruleId)
      .map((diagnostic) => testCase.source.slice(0, diagnostic.range[0]).split("\n").length);
  } finally {
    if (previous !== null) Deno.env.set(SELECTION_VARIABLE, previous);
  }
}

Deno.test("the plugin rules report the lines recorded for each parity case", () => {
  for (const testCase of PARITY_CASES) {
    assertEquals(pluginLines(testCase), [...testCase.nowLines], testCase.name);
  }
});

Deno.test("every line the deleted script rules reported is still reported, except their false positives", () => {
  for (const testCase of PARITY_CASES) {
    if (testCase.oldFalsePositive) continue;
    const reported = pluginLines(testCase);
    for (const line of testCase.oldLines) {
      assertEquals(reported.includes(line), true, `${testCase.name}: line ${line} must stay reported`);
    }
  }
});

Deno.test("the lint task also runs the two Deno rules over scripts/", async () => {
  const config = await readRepoJson("deno.json");
  const lintTask = (config.tasks as { [name: string]: string }).lint;
  assertStringIncludes(lintTask, "scripts/");
  assertStringIncludes(lintTask, `${EXAIX_PLUGIN_NAME}/require-deno-shebang`);
  assertStringIncludes(lintTask, `${EXAIX_PLUGIN_NAME}/no-forbidden-lint-ignore`);
});
