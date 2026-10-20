/**
 * @module LintPluginIntegrationTest
 * @path tests/scripts/lint_plugin_integration_test.ts
 * @description End-to-end checks that the exaix Deno lint plugin loads through the repo
 *   config, reports its rule id, and respects EXAIX_LINT_RULES selection without letting
 *   an exported value narrow the pre-commit gate.
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SEED_FILE = join(REPO_ROOT, "packages", "core", "src", "__temp_lint_plugin_violation.ts");
const SEED_SOURCE = "export const value = 1 as never as number;\n";

async function runDeno(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args,
    cwd: REPO_ROOT,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  return {
    code: result.code,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

async function withSeed<T>(
  body: (file: string) => Promise<T>,
  source: string = SEED_SOURCE,
  file: string = SEED_FILE,
): Promise<T> {
  await Deno.writeTextFile(file, source);
  try {
    return await body(file);
  } finally {
    await Deno.remove(file).catch(() => {});
  }
}

Deno.test("deno lint reports exaix/no-chained-type-assertions on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/no-chained-type-assertions");
  });
});

const INTERFACE_SEED = "export interface Foo {}\n";
const OFF_RULE_IGNORE_SEED = [
  "// deno-lint-ignore exaix/no-explicit-unknown -- the catalog turns this rule off",
  "export const value = 1;",
  "",
].join("\n");

Deno.test("deno lint reports exaix/exported-interface-naming on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/exported-interface-naming");
  }, INTERFACE_SEED);
});

Deno.test("an ignore comment for a rule the catalog turns off is unused, not an unknown rule code", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertStringIncludes(result.output, "ban-unused-ignore");
    assertFalse(result.output.includes("ban-unknown-rule-code"), result.output);
  }, OFF_RULE_IGNORE_SEED);
});

const FORBIDDEN_IGNORE_SEED = "// deno-lint-ignore no-explicit-any\nexport const value: any = 1;\n";
const SCRIPT_SEED_FILE = join(REPO_ROOT, "scripts", "__temp_lint_plugin_no_shebang.ts");
const SCRIPT_SEED_SOURCE = "export const value = 1;\n";
const SCRIPTS_RUN_RULES = "exaix/require-deno-shebang,exaix/no-forbidden-lint-ignore";

Deno.test("deno lint reports exaix/no-forbidden-lint-ignore on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/no-forbidden-lint-ignore");
  }, FORBIDDEN_IGNORE_SEED);
});

Deno.test("the scripts run of the lint task reports exaix/require-deno-shebang on a script without a shebang", async () => {
  await Deno.writeTextFile(SCRIPT_SEED_FILE, SCRIPT_SEED_SOURCE);
  try {
    const result = await runDeno(["lint", "--rules-tags=", SCRIPT_SEED_FILE], { EXAIX_LINT_RULES: SCRIPTS_RUN_RULES });
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/require-deno-shebang");
  } finally {
    await Deno.remove(SCRIPT_SEED_FILE).catch(() => {});
  }
});

const DYNAMIC_IMPORT_SEED = 'export const loaded = await import("./other.ts");\n';
const INLINE_TYPE_IMPORT_SEED = 'export type Loaded = import("./other.ts").IOther;\n';
const PARKED_REEXPORT_SEED = 'export { value } from "./other.ts";\n';
const ALIAS_SEED = "export type Fetcher = Promise<Response>;\n";
const PRAGMA_SEED = '// @ts-expect-error: the literal is checked at run time\nexport const value: number = "x";\n';
const PARKED_RETURN_SEED = 'export function get(): Promise<Response> {\n  return fetch("x");\n}\n';
const PARKED_UNION_SEED = 'export function mode(value: "fast" | "slow"): string {\n  return value;\n}\n';

Deno.test("deno lint reports exaix/dynamic-import on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/dynamic-import");
  }, DYNAMIC_IMPORT_SEED);
});

Deno.test("deno lint reports exaix/inline-type-import on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/inline-type-import");
  }, INLINE_TYPE_IMPORT_SEED);
});

Deno.test("deno lint reports exaix/promise-response-alias on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/promise-response-alias");
  }, ALIAS_SEED);
});

Deno.test("deno lint reports exaix/ts-suppression-pragmas on a described pragma", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/ts-suppression-pragmas");
    assertFalse(result.output.includes("ban-ts-comment"), result.output);
  }, PRAGMA_SEED);
});

Deno.test("a parked type-pattern rule is silent by default and reports when EXAIX_LINT_RULES selects it", async () => {
  const seeds = [["exaix/promise-response-return", PARKED_RETURN_SEED], ["exaix/magic-union-type", PARKED_UNION_SEED]];
  for (const [rule, source] of seeds) {
    await withSeed(async (file) => {
      const silent = await runDeno(["lint", file]);
      assertFalse(silent.output.includes(rule), silent.output);
      const selected = await runDeno(["lint", file], { EXAIX_LINT_RULES: rule });
      assertStringIncludes(selected.output, rule);
    }, source);
  }
});

const TEST_SEED_FILE = join(REPO_ROOT, "packages", "core", "tests", "__temp_lint_plugin_phase12_seed_test.ts");
const PLAIN_TEST_SEED_FILE = join(REPO_ROOT, "packages", "core", "tests", "__temp_lint_plugin_seed_test.ts");
const NO_USAGE_SEED_FILE = join(REPO_ROOT, "scripts", "__temp_lint_plugin_no_usage.ts");
const DECORATIVE_SEED = "/** header */\nexport const first = 1;\n// ==========\nexport const second = 2;\n";
const NO_HEADER_SEED = "export const value = 1;\n";
const NO_USAGE_SEED = "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n */\nexport const value = 1;\n";
const LONG_COMMENT_SEED =
  "/** header */\nexport const first = 1;\n// one\n// two\n// three\n// four\nexport const second = 2;\n";
const EPHEMERAL_SEED = "/** header */\nexport const first = 1;\n// we tried a loop first\nexport const second = 2;\n";
const MAX_PARAMS_SEED =
  "/** header */\nexport function take(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): void {}\n";
const FIXTURE_SEED = "/** header */\nconst yaml = `\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 7\n`;\n";

Deno.test("deno lint reports exaix/decorative-comment and exaix/require-module-header on seeded violations", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/decorative-comment");
  }, DECORATIVE_SEED);
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertStringIncludes(result.output, "exaix/require-module-header");
  }, NO_HEADER_SEED);
});

Deno.test("deno lint reports exaix/ephemeral-filename on a test file named after a phase", async () => {
  await withSeed(
    async (file) => {
      const result = await runDeno(["lint", file]);
      assertEquals(result.code === 0, false, result.output);
      assertStringIncludes(result.output, "exaix/ephemeral-filename");
    },
    "/** header */\nexport const value = 1;\n",
    TEST_SEED_FILE,
  );
});

Deno.test("the scripts run reports exaix/require-script-usage on a script header without a Usage section", async () => {
  await withSeed(
    async (file) => {
      const result = await runDeno(["lint", "--rules-tags=", file], { EXAIX_LINT_RULES: "exaix/require-script-usage" });
      assertEquals(result.code === 0, false, result.output);
      assertStringIncludes(result.output, "exaix/require-script-usage");
    },
    NO_USAGE_SEED,
    NO_USAGE_SEED_FILE,
  );
});

Deno.test("a parked comment, parameter, or fixture rule is silent by default and reports when selected", async () => {
  const seeds: [string, string, string][] = [
    ["exaix/long-comment", LONG_COMMENT_SEED, SEED_FILE],
    ["exaix/ephemeral-comment", EPHEMERAL_SEED, SEED_FILE],
    ["exaix/max-params", MAX_PARAMS_SEED, SEED_FILE],
    ["exaix/test-inline-multiline-fixture", FIXTURE_SEED, PLAIN_TEST_SEED_FILE],
  ];
  for (const [rule, source, path] of seeds) {
    await withSeed(
      async (file) => {
        const silent = await runDeno(["lint", file]);
        assertFalse(silent.output.includes(rule), silent.output);
        const selected = await runDeno(["lint", file], { EXAIX_LINT_RULES: rule });
        assertStringIncludes(selected.output, rule);
      },
      source,
      path,
    );
  }
});

Deno.test("a parked rule is silent by default and reports when EXAIX_LINT_RULES selects it", async () => {
  await withSeed(async (file) => {
    const silent = await runDeno(["lint", file]);
    assertFalse(silent.output.includes("exaix/re-export-imported"), silent.output);
    const selected = await runDeno(["lint", file], { EXAIX_LINT_RULES: "exaix/re-export-imported" });
    assertStringIncludes(selected.output, "exaix/re-export-imported");
  }, PARKED_REEXPORT_SEED);
});

Deno.test("EXAIX_LINT_RULES selects the rule and the entry prints a narrowing notice", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file], {
      EXAIX_LINT_RULES: "exaix/no-chained-type-assertions",
    });
    assertStringIncludes(result.output, "exaix/no-chained-type-assertions");
    assertStringIncludes(result.output, "EXAIX_LINT_RULES");
  });
});

Deno.test("EXAIX_LINT_RULES narrows plugin rules when a non-matching value is set", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file], { EXAIX_LINT_RULES: "exaix/no-such-rule" });
    assertFalse(result.output.includes("exaix/no-chained-type-assertions"), result.output);
  });
});

Deno.test("EXAIX_LINT_RULES selects by tag", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file], { EXAIX_LINT_RULES: "tag:type-safety" });
    assertStringIncludes(result.output, "exaix/no-chained-type-assertions");
  });
});

Deno.test("the lint task clears EXAIX_LINT_RULES so an exported value cannot narrow the gate", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json")));
  assertStringIncludes(config.tasks.lint, "EXAIX_LINT_RULES=");
});

Deno.test("[regression] with the selection variable cleared, one file reports every violated plugin rule", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json")));
  assertEquals(config.tasks.lint.startsWith("EXAIX_LINT_RULES= deno lint"), true);
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file], { EXAIX_LINT_RULES: "" });
    assertStringIncludes(result.output, "exaix/no-chained-type-assertions");
    assertStringIncludes(result.output, "exaix/exported-interface-naming");
    assertFalse(result.output.includes("EXAIX_LINT_RULES active"), result.output);
  }, `${SEED_SOURCE}export interface Foo {\n  readonly a: number;\n}\n`);
});
