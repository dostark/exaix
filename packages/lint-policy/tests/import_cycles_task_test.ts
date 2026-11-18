/**
 * @module ImportCyclesTaskTest
 * @path packages/lint-policy/tests/import_cycles_task_test.ts
 * @description The advisory `check:cycles` task reports the real repository cycles in text and in JSON.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/src/script_rules.ts, packages/lint-policy/src/policy_config.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const TIMEOUT_MS = 240_000;

interface ICommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `deno task` in the repository root. */
async function task(name: string, extra: readonly string[] = []): Promise<ICommandResult> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", name, ...extra],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

Deno.test("cycle-task-advisory: check:cycles reports the repository cycles and exits 0", async () => {
  const result = await task("check:cycles");
  assertEquals(result.code, 0, result.stderr);
  assertStringIncludes(result.stdout, "UNSLOP IMPORT CYCLES");
  assertStringIncludes(result.stdout, "runtime cycle(s)");
  assertStringIncludes(result.stdout, "Graph ");
});

Deno.test("cycle-task-json: check:cycles can emit the JSON report for evidence", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      join(ROOT, "unslop-ts/src/cli/whole_tree.ts"),
      "--descriptor=packages/lint-policy/unslop.project.ts",
      "--rule=import-cycles",
      "--format=json",
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const report = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    version: number;
    totals: { runtime_sccs: number; files: number };
    graph: { code_files: number; complete: boolean };
    cycles: readonly { id: string; kind: string; files: readonly string[] }[];
  };
  assertEquals(report.version, 1);
  const runtimeFiles = report.cycles
    .filter((cycle) => cycle.kind === "runtime")
    .reduce((sum, cycle) => sum + cycle.files.length, 0);
  assertEquals(report.totals.files, runtimeFiles);
  assert(report.graph.code_files > 0);
  for (const cycle of report.cycles) assertStringIncludes(cycle.id, "cyc-");
});
