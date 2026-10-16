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

async function withSeed<T>(body: (file: string) => Promise<T>): Promise<T> {
  await Deno.writeTextFile(SEED_FILE, SEED_SOURCE);
  try {
    return await body(SEED_FILE);
  } finally {
    await Deno.remove(SEED_FILE).catch(() => {});
  }
}

Deno.test("deno lint reports exaix/no-chained-type-assertions on a seeded violation", async () => {
  await withSeed(async (file) => {
    const result = await runDeno(["lint", file]);
    assertEquals(result.code === 0, false, result.output);
    assertStringIncludes(result.output, "exaix/no-chained-type-assertions");
  });
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
