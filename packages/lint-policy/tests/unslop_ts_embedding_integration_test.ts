/**
 * @module UnslopTsEmbeddingIntegrationTest
 * @path packages/lint-policy/tests/unslop_ts_embedding_integration_test.ts
 * @description Clones the repository without submodules, initializes unslop-ts through the deploy script, and drives the real lint and check tasks in the clone: seeded violations are reported by the Exaix, TypeScript, and Deno rule packs, and a clean tree passes every gate.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/src/tools/deploy_engine.ts, tests/scripts/ci_wiring_test.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const ENGINE_SUBMODULE = "unslop-ts";
const TEAM_SUBMODULE = "exaix-team";
const PACKAGE_SEED = "packages/core/src/__temp_embedding_seed.ts";
const SCRIPT_SEED = "scripts/__temp_embedding_seed.ts";
const PACKAGE_SEED_SOURCE = [
  "export interface Foo {}",
  "export const chained = 1 as unknown as number;",
  "// deno-lint-ignore no-explicit-any",
  "export const loose: any = 1;",
  "",
].join("\n");
const SCRIPT_SEED_SOURCE = "export const value = 1;\n";
const EXPECTED_PACKAGE_RULES: readonly string[] = [
  "exaix/exported-interface-naming",
  "exaix/no-chained-type-assertions",
  "exaix/no-forbidden-lint-ignore",
];
const BOOTSTRAP_ARGS: readonly string[] = [
  "run",
  "--no-config",
  "--allow-run",
  "--allow-read",
  "--allow-env",
  "packages/lint-policy/src/tools/deploy_engine.ts",
];
const SHEBANG_RULE = "exaix/require-deno-shebang";
const CLEAN_TASKS: readonly string[] = ["lint", "check:style", "check:complexity", "check:unused-exports"];
const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
  GIT_TERMINAL_PROMPT: "0",
};

interface IRun {
  readonly code: number;
  readonly output: string;
}

async function run(command: string, args: readonly string[], cwd: string): Promise<IRun> {
  const result = await new Deno.Command(command, {
    args: [...args],
    cwd,
    env: { ...GIT_ENV, EXAIX_LINT_RULES: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, output: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await run("git", args, cwd);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.output}`);
}

function task(clone: string, name: string, ...args: string[]): Promise<IRun> {
  return run(Deno.execPath(), ["task", name, ...args], clone);
}

async function pathExists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false);
}

function gitOnPath(): boolean {
  try {
    return new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" }).outputSync().success;
  } catch {
    return false;
  }
}

/** The reason this test cannot run in the current checkout, or null when it can. */
async function skipReason(): Promise<string | null> {
  if (!(await pathExists(join(REPO_ROOT, ".git")))) return "the checkout has no .git directory to clone";
  if (!gitOnPath()) return "git is not on the path";
  for (const submodule of [ENGINE_SUBMODULE, TEAM_SUBMODULE]) {
    if (!(await pathExists(join(REPO_ROOT, submodule, ".git")))) return `${submodule} is not initialized`;
  }
  return null;
}

const SKIP_REASON = await skipReason();
if (SKIP_REASON !== null) console.warn(`unslop_ts_embedding_integration_test is ignored: ${SKIP_REASON}`);

async function prepareClone(root: string): Promise<string> {
  const clone = join(root, "clone");
  await git(root, "clone", "-q", "--no-recurse-submodules", REPO_ROOT, clone);
  await git(clone, "config", `submodule.${ENGINE_SUBMODULE}.url`, join(REPO_ROOT, ENGINE_SUBMODULE));
  await git(clone, "config", `submodule.${TEAM_SUBMODULE}.url`, join(REPO_ROOT, TEAM_SUBMODULE));
  await git(clone, "submodule", "update", "--init", "-q", TEAM_SUBMODULE);
  return clone;
}

Deno.test({
  name: "a fresh clone runs every style gate through the embedded engine",
  ignore: SKIP_REASON !== null,
  fn: async () => {
    await withTempDir(async (root) => {
      const clone = await prepareClone(root);

      const init = await run(Deno.execPath(), [...BOOTSTRAP_ARGS, "--init"], clone);
      assertEquals(init.code, 0, init.output);

      await Deno.writeTextFile(join(clone, PACKAGE_SEED), PACKAGE_SEED_SOURCE);
      const packageLint = await task(clone, "lint");
      assertEquals(packageLint.code, 1, packageLint.output);
      for (const rule of EXPECTED_PACKAGE_RULES) assertStringIncludes(packageLint.output, rule);
      await Deno.remove(join(clone, PACKAGE_SEED));

      await Deno.writeTextFile(join(clone, SCRIPT_SEED), SCRIPT_SEED_SOURCE);
      const scriptLint = await task(clone, "lint");
      assertEquals(scriptLint.code, 1, scriptLint.output);
      assertStringIncludes(scriptLint.output, SHEBANG_RULE);
      await Deno.remove(join(clone, SCRIPT_SEED));

      for (const name of CLEAN_TASKS) {
        const clean = await task(clone, name);
        assertEquals(clean.code, 0, `${name}: ${clean.output}`);
      }
    }, { prefix: "unslop_ts_embedding_" });
  },
});
