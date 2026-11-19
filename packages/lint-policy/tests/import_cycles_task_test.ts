/**
 * @module ImportCyclesTaskTest
 * @path packages/lint-policy/tests/import_cycles_task_test.ts
 * @description The advisory cycle task and the baseline gate report the real repository cycles and fail on a new one.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/src/script_rules.ts, packages/lint-policy/src/policy_config.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const ENGINE = join(ROOT, "unslop-ts/src/cli/whole_tree.ts");
const BASELINE = join(ROOT, "packages/lint-policy/cycle_baseline.json");
const TIMEOUT_MS = 240_000;
const GATE_TIMEOUT_SEC = 180;

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

Deno.test("check-task-cycles-adopted: the cycle tasks run through the check route", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(ROOT, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  for (const name of ["check:cycles", "check:cycles:gate"]) {
    assertStringIncludes(config.tasks[name], "unslop-ts/src/cli/unslop.ts check");
    assertStringIncludes(config.tasks[name], "--rule=import-cycles");
  }
  assertStringIncludes(config.tasks["check:cycles:gate"], "--strict");
  const gate = await task("check:cycles:gate");
  assertEquals(gate.code, 0, gate.stderr);
  assertStringIncludes(gate.stderr, "import-cycle gate passed");
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

/** Runs the engine cycle check in a project directory with the given permissions. */
async function cycles(
  cwd: string,
  args: readonly string[],
  permissions: readonly string[] = ["--allow-read", "--allow-env"],
): Promise<ICommandResult> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", ...permissions, ENGINE, ...args],
    cwd,
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

interface ICycleJson {
  readonly totals: { readonly runtime_sccs: number; readonly files: number };
  readonly graph: {
    readonly complete: boolean;
    readonly code_files: number;
    readonly unresolved_refs: readonly { readonly from: string; readonly specifier: string }[];
  };
  readonly cycles: readonly { readonly id: string; readonly kind: string; readonly files: readonly string[] }[];
}

Deno.test("cycle-baseline-committed: the committed baseline matches the measured runtime cycles and the allowlist", async () => {
  const result = await cycles(ROOT, [
    "--descriptor=packages/lint-policy/unslop.project.ts",
    "--rule=import-cycles",
    "--format=json",
  ]);
  assertEquals(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout) as ICycleJson;
  const config = JSON.parse(await Deno.readTextFile(join(ROOT, "unslop.config.json"))) as {
    rules: Record<string, { options?: { gateRoots?: readonly string[] } }>;
  };
  const roots = config.rules["import-cycles"].options?.gateRoots ?? [];
  const gated = report.cycles
    .filter((cycle) =>
      cycle.kind === "runtime" && cycle.files.some((file) => roots.some((root) => file.startsWith(root)))
    )
    .map((cycle) => cycle.id)
    .sort();
  const baseline = JSON.parse(await Deno.readTextFile(BASELINE)) as {
    cycles: readonly { id: string }[];
    allowed_unresolved: readonly { from: string; specifier: string; reason: string }[];
  };
  assertEquals(baseline.cycles.map((cycle) => cycle.id).sort(), gated);
  const allowed = new Set(baseline.allowed_unresolved.map((entry) => `${entry.from}\u0000${entry.specifier}`));
  for (const reference of report.graph.unresolved_refs) {
    assert(allowed.has(`${reference.from}\u0000${reference.specifier}`), `${reference.from} ${reference.specifier}`);
  }
  for (const entry of baseline.allowed_unresolved) assert(entry.reason.length > 0);
});

Deno.test("cycle-gate-existing: the gate passes the committed baseline", async () => {
  const result = await task("check:cycles:gate");
  assertEquals(result.code, 0, result.stderr);
  assertStringIncludes(result.stderr, "0 new · 0 changed · 0 stale");
  assertStringIncludes(result.stderr, "import-cycle gate passed");
});

Deno.test("cycle-gate-new: a seeded runtime cycle fails the gate", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cycle_gate_" });
  try {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(
      join(dir, "catalog.json"),
      JSON.stringify({
        version: "1",
        scopes: { test: ["**/tests/**"], fixture: [] },
        wholeTree: { importCycles: { baseline: "baseline.json" } },
      }),
    );
    await Deno.writeTextFile(join(dir, "src/a.ts"), 'import { b } from "./b.ts";\nexport const a = b;\n');
    await Deno.writeTextFile(join(dir, "src/b.ts"), 'import { a } from "./a.ts";\nexport const b = 1;\n');
    const update = await cycles(dir, [
      "--rule=import-cycles",
      "--catalog=catalog.json",
      "--update-baseline",
    ], ["-A"]);
    assertEquals(update.code, 0, update.stderr);
    await Deno.writeTextFile(join(dir, "src/c.ts"), 'import { d } from "./d.ts";\nexport const c = d;\n');
    await Deno.writeTextFile(join(dir, "src/d.ts"), 'import { c } from "./c.ts";\nexport const d = 1;\n');
    const gated = await cycles(dir, [
      "--rule=import-cycles",
      "--catalog=catalog.json",
      "--fail-on-new",
      "--fail-on-stale",
    ]);
    assertEquals(gated.code, 1);
    assertStringIncludes(gated.stderr, "1 new");
    assertStringIncludes(gated.stderr, "NEW runtime");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cycle-gate-timeout: the workflow gate carries the recorded timeout", async () => {
  const workflow = await Deno.readTextFile(join(ROOT, ".github/workflows/code-quality.yml"));
  const start = workflow.indexOf("Gate 28");
  assert(start > 0, "Gate 28 is missing");
  const step = workflow.slice(start, workflow.indexOf("- name:", start + 10));
  assertStringIncludes(step, "deno task check:cycles:gate");
  assertStringIncludes(step, `timeout-minutes: ${GATE_TIMEOUT_SEC / 60}`);
});
