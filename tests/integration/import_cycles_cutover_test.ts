/**
 * @module ImportCyclesCutoverTest
 * @path tests/integration/import_cycles_cutover_test.ts
 * @description Drives the real whole-tree CLI over a fixture with aliases, a barrel, a dynamic import and every cycle kind, and over the real repository.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/src/script_rules.ts, packages/lint-policy/src/policy_config.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ENGINE = join(ROOT, "unslop-ts/src/cli/whole_tree.ts");
const TIMEOUT_MS = 240_000;

interface ICommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

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

interface ICycleReport {
  readonly totals: {
    readonly runtime_sccs: number;
    readonly type_only_sccs: number;
    readonly mixed_sccs: number;
    readonly files: number;
  };
  readonly graph: {
    readonly complete: boolean;
    readonly code_files: number;
    readonly unresolved: number;
    readonly unresolved_refs: readonly { readonly from: string; readonly specifier: string }[];
  };
  readonly cycles: readonly {
    readonly id: string;
    readonly kind: string;
    readonly files: readonly string[];
    readonly edges: readonly { readonly from: string; readonly to: string; readonly form: string }[];
  }[];
}

/** A fixture with an alias, a barrel, a literal dynamic import, and a runtime, time-only and mixed cycle. */
const FIXTURE: Readonly<Record<string, string>> = {
  "deno.json": JSON.stringify({ imports: { "@lib/": "./src/lib/" } }),
  "catalog.json": JSON.stringify({
    version: "1",
    scopes: { test: ["**/tests/**"], fixture: [] },
    wholeTree: { importCycles: {} },
  }),
  "src/lib/a.ts": 'import { b } from "@lib/b.ts";\nexport const a = b;\n',
  "src/lib/b.ts": 'import { a } from "./a.ts";\nexport const b = a + 1;\n',
  "src/barrel.ts": 'export { c } from "./c.ts";\n',
  "src/c.ts": 'import { barrel } from "./site.ts";\nexport const c = 1;\nexport type Barrel = typeof barrel;\n',
  "src/site.ts": 'import { c } from "./barrel.ts";\nexport const barrel = c;\n',
  "src/dyn.ts": 'export const dyn = 1;\nexport const nested = await import("./holder.ts");\n',
  "src/holder.ts": 'import { dyn } from "./dyn.ts";\nexport const holder = dyn;\n',
  "src/t1.ts": 'import type { T2 } from "./t2.ts";\nexport type T1 = T2;\n',
  "src/t2.ts": 'import type { T1 } from "./t1.ts";\nexport type T2 = T1;\n',
  "src/m1.ts": 'import { m2 } from "./m2.ts";\nexport const m1 = m2;\nexport type M1 = { a: number };\n',
  "src/m2.ts": 'import type { M1 } from "./m1.ts";\nexport const m2 = 1;\nexport type M2 = M1;\n',
};

async function writeFixture(dir: string): Promise<void> {
  for (const [path, source] of Object.entries(FIXTURE)) {
    await Deno.mkdir(join(dir, path, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, path), source);
  }
}

Deno.test("import-cycles-cutover-fixture: the real CLI resolves an alias, a barrel and a dynamic import, and reports every kind", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cycle_cutover_" });
  try {
    await writeFixture(dir);
    const report = await cycles(dir, ["--rule=import-cycles", "--catalog=catalog.json", "--format=json"]);
    assertEquals(report.code, 0, report.stderr);
    const parsed = JSON.parse(report.stdout) as ICycleReport;
    const kinds = new Set(parsed.cycles.map((cycle) => cycle.kind));
    assert(kinds.has("runtime"));
    assert(kinds.has("type-only"));
    assert(kinds.has("mixed"));

    const aliased = parsed.cycles.find((cycle) =>
      cycle.files.includes("src/lib/a.ts") && cycle.files.includes("src/lib/b.ts")
    );
    assert(aliased !== undefined, "the alias cycle is missing");
    const barrel = parsed.cycles.find((cycle) => cycle.files.includes("src/barrel.ts"));
    assert(barrel !== undefined, "the barrel cycle is missing");
    const dynamic = parsed.cycles.find((cycle) => cycle.files.includes("src/dyn.ts"));
    assert(dynamic !== undefined, "the dynamic-import cycle is missing");
    assertEquals(
      dynamic.edges.some((edge) => edge.from === "src/dyn.ts" && edge.form === "dynamic"),
      true,
    );

    const gate = await cycles(dir, [
      "--rule=import-cycles",
      "--catalog=catalog.json",
      "--baseline=baseline.json",
      "--update-baseline",
    ], ["-A"]);
    assertEquals(gate.code, 0, gate.stderr);
    const passing = await cycles(dir, [
      "--rule=import-cycles",
      "--catalog=catalog.json",
      "--baseline=baseline.json",
      "--fail-on-new",
      "--fail-on-stale",
    ]);
    assertEquals(passing.code, 0, passing.stderr);
    assertStringIncludes(passing.stderr, "import-cycle gate passed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("import-cycles-cutover-real: the real repository report records the counts, the graph state and the baseline match", async () => {
  const report = await cycles(ROOT, [
    "--descriptor=packages/lint-policy/unslop.project.ts",
    "--rule=import-cycles",
    "--format=json",
  ]);
  assertEquals(report.code, 0, report.stderr);
  const parsed = JSON.parse(report.stdout) as ICycleReport;
  const baseline = JSON.parse(await Deno.readTextFile(join(ROOT, "packages/lint-policy/cycle_baseline.json"))) as {
    cycles: readonly { id: string }[];
    allowed_unresolved: readonly { from: string; specifier: string; reason: string }[];
    allowed_unresolved_population?: number;
  };
  assertEquals(parsed.totals.runtime_sccs, 0);
  assertEquals(parsed.totals.files, 0);
  assertEquals(parsed.totals.type_only_sccs, 0);
  assertEquals(parsed.totals.mixed_sccs, parsed.cycles.filter((cycle) => cycle.kind === "mixed").length);
  const allowed = new Set(baseline.allowed_unresolved.map((entry) => `${entry.from}\u0000${entry.specifier}`));
  for (const reference of parsed.graph.unresolved_refs) {
    assert(allowed.has(`${reference.from}\u0000${reference.specifier}`), `${reference.from} ${reference.specifier}`);
  }
  assertEquals(parsed.graph.unresolved, parsed.graph.unresolved_refs.length);
  assert(parsed.graph.code_files > 0);
  assertEquals(baseline.cycles.length, 0);
  for (const entry of baseline.allowed_unresolved) assert(entry.reason.length > 0);
  assertEquals(parsed.cycles.filter((cycle) => cycle.kind === "runtime"), []);
});

Deno.test("import-cycles-cutover-baseline: the real gate passes the committed baseline and rejects a cycle it does not list", async () => {
  const passing = await cycles(ROOT, [
    "--descriptor=packages/lint-policy/unslop.project.ts",
    "--rule=import-cycles",
    "--baseline=packages/lint-policy/cycle_baseline.json",
    "--fail-on-new",
    "--fail-on-stale",
  ]);
  assertEquals(passing.code, 0, passing.stderr);
  assertStringIncludes(passing.stderr, "0 matched");

  const dir = await Deno.makeTempDir({ prefix: "cycle_cutover_gate_" });
  try {
    await writeFixture(dir);
    assertEquals(
      (await cycles(dir, [
        "--rule=import-cycles",
        "--catalog=catalog.json",
        "--baseline=baseline.json",
        "--update-baseline",
      ], ["-A"])).code,
      0,
    );
    await Deno.writeTextFile(join(dir, "src/new_a.ts"), 'import { b } from "./new_b.ts";\nexport const a = b;\n');
    await Deno.writeTextFile(join(dir, "src/new_b.ts"), 'import { a } from "./new_a.ts";\nexport const b = 1;\n');
    const failing = await cycles(dir, [
      "--rule=import-cycles",
      "--catalog=catalog.json",
      "--baseline=baseline.json",
      "--fail-on-new",
      "--fail-on-stale",
    ]);
    assertEquals(failing.code, 1, failing.stderr + failing.stdout);
    assertStringIncludes(failing.stderr, "NEW runtime");
    assertStringIncludes(failing.stderr, "src/new_a.ts, src/new_b.ts");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
