/**
 * @module PhaseBaseCheckerHelper
 * @path packages/lint-policy/tests/helpers/phase_base_checker.ts
 * @description Rebuilds the style checker and the magic-value host of the Phase 227 base commit from git and runs them over the current tree.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [packages/lint-policy/tests/helpers/script_port_parity.ts, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** The parent commit before the first rule of Phase 227 moved. */
const PHASE_BASE_COMMIT = "11df96584b404963ec0b28a26623c8c29b0a588c";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const POLICY_ROOT = "packages/lint-policy";
const BASE_FILES: readonly string[] = [
  "catalog.json",
  "src/checkers/check_code_style.ts",
  "src/checkers/check_magic_values.ts",
  "src/repo_layout.ts",
  "src/rule_packs.ts",
  "src/rule_pack/mod.ts",
  "src/rule_pack/exported_interface_naming.ts",
];
const PACKS_FILE = "src/rule_packs.ts";
const PACK_LIST_WITH_EXAIX = "[TYPESCRIPT_RULE_PACK, DENO_RULE_PACK, EXAIX_RULE_PACK]";
const PACK_LIST_ENGINE_ONLY = "[TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]";
const EXAIX_PACK_IMPORT = 'import { EXAIX_PLUGIN_NAME, EXAIX_RULE_PACK } from "./rule_pack/mod.ts";';
const PLUGIN_NAME_IMPORT = 'import { EXAIX_PLUGIN_NAME } from "./rule_pack/mod.ts";';

interface IBaselineHosts {
  readonly style: string;
  readonly magic: string;
}

interface ICheckerRun {
  readonly code: number;
  readonly output: string;
}

async function gitShow(path: string): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["show", `${PHASE_BASE_COMMIT}:${POLICY_ROOT}/${path}`],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(`git show failed for ${path}: ${new TextDecoder().decode(result.stderr).trim()}`);
  }
  return new TextDecoder().decode(result.stdout);
}

/**
 * Writes the base checkers into a temporary directory and passes their paths to `body`.
 * One edit differs from the base. The base pack list drops the Exaix pack, because the engine owns interface naming.
 */
export async function withPhaseBaseCheckers<T>(body: (hosts: IBaselineHosts) => Promise<T>): Promise<T> {
  const sandbox = await Deno.makeTempDir({ prefix: "phase_base_" });
  try {
    for (const file of BASE_FILES) {
      let text = await gitShow(file);
      if (file === PACKS_FILE) {
        text = text.replace(PACK_LIST_WITH_EXAIX, PACK_LIST_ENGINE_ONLY).replace(EXAIX_PACK_IMPORT, PLUGIN_NAME_IMPORT);
      }
      const target = join(sandbox, "policy", file);
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.writeTextFile(target, text);
    }
    return await body({
      style: join(sandbox, "policy", "src/checkers/check_code_style.ts"),
      magic: join(sandbox, "policy", "src/checkers/check_magic_values.ts"),
    });
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
}

/** Runs one base checker over the repository tree with the current import map. */
export async function runBaseChecker(host: string): Promise<ICheckerRun> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", `--config=${join(REPO_ROOT, "deno.json")}`, host, `--root=${REPO_ROOT}`],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, output: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}
