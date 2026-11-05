/**
 * @module GodObjectsComparisonFixture
 * @path packages/lint-policy/tests/helpers/god_objects_comparison.ts
 * @description Shared class strategy fixtures and real comparison CLI invocation.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/tests/god_objects_cutover_test.ts, packages/lint-policy/tests/god_objects_compare_security_test.ts]
 */
import { join } from "@std/path";
import { CEILING_REPO_ROOT, type ICeilingRule, type IProcessRun, runDeno } from "./ceiling_project.ts";
const COMPARE = join(CEILING_REPO_ROOT, "scripts/god_objects_compare.ts");
export const RULE = "demo/max-class-size";
const KEY = "max-class-size";
const GOD_CLASS = "god-class";
/** The legacy score flags every class under these options, and the God Class strategy ignores them. */
export const GOD_RULE: ICeilingRule = { key: KEY, options: { strategy: GOD_CLASS, minClassLines: 1, threshold: 1 } };
export const SMALL_CLASS =
  "export class Small {\n  one(): number {\n    return 1;\n  }\n  two(): number {\n    return 2;\n  }\n}\n";

export async function compareOver(dir: string, extra: readonly string[] = []): Promise<IProcessRun> {
  return await runDeno([
    "run",
    "-A",
    COMPARE,
    `--rule=${RULE}`,
    "--roots=packages",
    "--descriptor=unslop.project.ts",
    "--ceilings=rule_ceilings.json",
    ...extra,
  ], dir);
}
