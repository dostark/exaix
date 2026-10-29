/**
 * @module CompareComplexityTest
 * @path packages/lint-policy/tests/compare_complexity_test.ts
 * @description Matching, validation and inventory checks for the fallow complexity calibration.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [../src/tools/compare_complexity.ts, packages/lint-policy/tests/complexity_cutover_test.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { basename, dirname, fromFileUrl, join } from "@std/path";
import type { IMeasuredFunction } from "@dostark/unslop-ts/report";
import {
  CALIBRATION_EXCLUSIONS,
  compareComplexity,
  CompareError,
  coreKeyOf,
  type IExclusion,
  type IFallowFinding,
  type IFallowReport,
  matchFunctions,
  normalizePath,
  parseFallowReport,
} from "../src/tools/compare_complexity.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const PLAN_PATH = join(REPO_ROOT, "exaix-dev-docs/planning/phase-236-complexity-metrics-alignment.md");

function finding(line: number, col: number, cyclomatic = 3, cognitive = 2, name = "fn"): IFallowFinding {
  return { path: "src/a.ts", name, line, col, cyclomatic, cognitive };
}

function coreRow(line: number, col: number, cyclomatic = 3, cognitive = 2, name = "fn"): IMeasuredFunction {
  return {
    path: "src/a.ts",
    name,
    line,
    col,
    byte_col: col,
    cyclomatic,
    cognitive,
    line_count: 4,
    param_count: 1,
    contributions: [],
  };
}

function report(findings: readonly IFallowFinding[]): IFallowReport {
  return { kind: "health", schema_version: 12, version: "3.36.0", findings };
}

Deno.test("compare-complexity-matching: positions match, and names never decide a row", () => {
  const match = matchFunctions(
    [finding(5, 0, 3, 2, "first"), finding(5, 20, 4, 3, "second")],
    [coreRow(5, 0, 3, 2, "<anonymous>@5:1"), coreRow(5, 20, 4, 3, "second")],
  );
  assertEquals(match.matched.length, 2);
  assertEquals(match.fallowOnly, []);
  assertEquals(match.coreOnly, []);
  assertEquals(match.matched[0].core.name, "<anonymous>@5:1");
});

Deno.test("compare-complexity-matching: misses, byte columns and ambiguity are explicit", () => {
  const unmatched = matchFunctions([finding(5, 0)], [coreRow(6, 0)]);
  assertEquals(unmatched.matched, []);
  assertEquals(unmatched.fallowOnly.length, 1);
  assertEquals(unmatched.coreOnly.length, 1);

  const byteColumn = matchFunctions([finding(9, 12)], [coreRow(9, 10)]);
  assertEquals(byteColumn.matched, []);

  const ambiguous = matchFunctions([finding(7, 0), finding(7, 0)], [coreRow(7, 0)]);
  assertEquals(ambiguous.matched, []);
  assertEquals(ambiguous.ambiguous.length, 1);
  assertEquals(ambiguous.ambiguous[0].fallow, 2);
  assertEquals(ambiguous.coreOnly, []);
});

Deno.test("compare-complexity-matching: the core key uses the byte column", () => {
  const row = { ...coreRow(9, 10), byte_col: 12 };
  assertEquals(coreKeyOf(row), "src/a.ts:9:12");
  assertEquals(normalizePath("./src\\a.ts"), "src/a.ts");
});

Deno.test("compare-complexity-matching: schema, version, kind and empty populations are refused", () => {
  const valid = JSON.stringify(report([finding(1, 0)]));
  assertEquals(parseFallowReport(valid).schema_version, 12);
  assertThrows(() => parseFallowReport("not json"), CompareError);
  assertThrows(() => parseFallowReport(JSON.stringify({ ...report([]), schema_version: 11 })), CompareError);
  assertThrows(() => parseFallowReport(JSON.stringify({ ...report([]), version: "3.35.0" })), CompareError);
  assertThrows(() => parseFallowReport(JSON.stringify({ ...report([]), kind: "dupes" })), CompareError);
  assertThrows(() => parseFallowReport(JSON.stringify(report([]))), CompareError);
  assertThrows(
    () => parseFallowReport(JSON.stringify({ ...report([]), findings: [{ path: "src/a.ts" }] })),
    CompareError,
  );
});

Deno.test("compare-complexity-matching: the comparison keeps both full populations and reports tool-only files", () => {
  const fallow = report([finding(1, 0), finding(2, 0)]);
  const core = [coreRow(1, 0, 2, 1), { ...coreRow(1, 0), path: "src/b.ts" }];
  const comparison = compareComplexity(fallow, core, 1, []);
  assertEquals(comparison.populations.fallow_files, 1);
  assertEquals(comparison.populations.core_files, 2);
  assertEquals(comparison.populations.common_files, 1);
  assertEquals(comparison.populations.fallow, 2);
  assertEquals(comparison.populations.core, 2);
  assertEquals(comparison.populations.core_parse_failures, 1);
  assertEquals(comparison.populations.matched, 1);
  assertEquals(comparison.populations.unmatched_fallow, 1);
  assertEquals(comparison.populations.unmatched_core, 1);
  assertEquals(comparison.differences.length, 1);
  assertEquals(comparison.differences[0].core_cyclomatic, 2);
  assertEquals(comparison.sufficient, false);
});

/** `count` fallow findings and the same count of core rows, on one file, at consecutive lines from `start`. */
function populations(count: number, start = 1): { fallow: IFallowFinding[]; core: IMeasuredFunction[] } {
  const lines = Array.from({ length: count }, (_, index) => start + index);
  return { fallow: lines.map((line) => finding(line, 0)), core: lines.map((line) => coreRow(line, 0)) };
}

Deno.test("compare-full-population-sufficiency: one common match among 101 subjects fails and parse failures or ambiguity cannot pass", () => {
  const sparse = populations(101);
  const shifted = sparse.core.map((row, index) => (index === 0 ? row : { ...row, line: row.line + 1000 }));
  const lonely = compareComplexity(report(sparse.fallow), shifted, 5, []);
  assertEquals(lonely.populations.matched, 1);
  assertEquals(lonely.coverage.fallow < 0.99, true);
  assertEquals(lonely.sufficient, false);

  const toolOnly = populations(100);
  const otherFiles = toolOnly.fallow.map((row, index) => ({ ...row, path: `only/fallow_${index}.ts` }));
  const withTail = compareComplexity(
    report([...populations(1).fallow, ...otherFiles]),
    [...populations(1).core, ...toolOnly.core.map((row, index) => ({ ...row, path: `only/core_${index}.ts` }))],
    0,
    [],
  );
  assertEquals(withTail.populations.matched, 1);
  assertEquals(withTail.sufficient, false);

  const exact = populations(200);
  assertEquals(compareComplexity(report(exact.fallow), exact.core, 0, []).sufficient, true);
  assertEquals(compareComplexity(report(exact.fallow), exact.core, 1, []).sufficient, false);

  const duplicated = compareComplexity(report([...exact.fallow, finding(1, 0, 9, 9, "twin")]), exact.core, 0, []);
  assertEquals(duplicated.populations.ambiguous, 1);
  assertEquals(duplicated.coverage.fallow >= 0.99, true);
  assertEquals(duplicated.sufficient, false);
  assertEquals(duplicated.unmatched.ambiguous.length, 1);
});

Deno.test("compare-explicit-exclusions: only justified exclusions leave a population and every identity stays available", () => {
  const exact = populations(150);
  const extraFallow = [1, 2, 3].map((line) => ({ ...finding(line, 0), path: "tests/fixtures/x.ts" }));
  const extraCore = [1, 2].map((line) => ({ ...coreRow(line, 0), path: "generated/bundle.js" }));
  const exclusions: IExclusion[] = [
    { tool: "fallow", path: "tests/fixtures/", reason: "Fixture projects are test data." },
    { tool: "core", path: "generated/bundle.js", reason: "A generated bundle." },
  ];
  const excluded = compareComplexity(
    report([...exact.fallow, ...extraFallow]),
    [...exact.core, ...extraCore],
    0,
    exclusions,
  );
  assertEquals(excluded.sufficient, true);
  assertEquals(excluded.populations.fallow, 150);
  assertEquals(excluded.populations.core, 150);
  assertEquals(excluded.exclusions.map((entry) => [entry.tool, entry.path, entry.functions, entry.files]), [
    ["fallow", "tests/fixtures/", 3, ["tests/fixtures/x.ts"]],
    ["core", "generated/bundle.js", 2, ["generated/bundle.js"]],
  ]);
  assertEquals(excluded.exclusions.every((entry) => entry.reason.length > 0), true);

  const unlisted = compareComplexity(
    report([...exact.fallow, ...extraFallow]),
    [...exact.core, ...extraCore],
    0,
    exclusions.slice(0, 1),
  );
  assertEquals(unlisted.populations.unmatched_core, 2);
  assertEquals(unlisted.unmatched.core.length, 2);
  assertEquals(unlisted.unmatched.core[0].path, "generated/bundle.js");
  assertThrows(
    () => compareComplexity(report(exact.fallow), exact.core, 0, [{ tool: "core", path: "generated/", reason: " " }]),
    CompareError,
    "needs a path and a reason",
  );
  assertEquals(CALIBRATION_EXCLUSIONS.every((entry) => entry.reason.trim().length > 0 && entry.path.length > 0), true);
});

Deno.test("compare-complexity-matching: a contribution-kind difference is reported by kind", () => {
  const withKinds: IFallowFinding = {
    ...finding(1, 0, 3, 2),
    contributions: [{ line: 1, col: 4, metric: "cyclomatic", kind: "if", weight: 1, nesting: 0 }],
  };
  const other = report([withKinds]);
  const comparison = compareComplexity(other, [coreRow(1, 0, 3, 2)]);
  assertEquals(comparison.differences.length, 1);
  assertEquals(comparison.differences[0].contributions, [
    { metric: "cyclomatic", kind: "if", fallow: 1, core: 0 },
  ]);
});

/** True when a symbol name appears in the source package of the named source file. */
async function symbolExistsNear(symbol: string, sourcePath: string): Promise<boolean> {
  const parts = sourcePath.split("/");
  const packageRoot = parts.length >= 2 ? join(parts[0], parts[1]) : ".";
  const visit = async (directory: string): Promise<boolean> => {
    for await (const entry of Deno.readDir(join(REPO_ROOT, directory))) {
      if (entry.isDirectory) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        if (await visit(join(directory, entry.name))) return true;
        continue;
      }
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
      if ((await Deno.readTextFile(join(REPO_ROOT, directory, entry.name))).includes(symbol)) return true;
    }
    return false;
  };
  return await visit(packageRoot);
}

/** The repository path of a caller file, allowing a bare basename beside the source file. */
async function resolveCallerPath(rawPath: string, sourcePath: string): Promise<string> {
  const direct = join(REPO_ROOT, rawPath);
  try {
    await Deno.stat(direct);
    return rawPath;
  } catch {
    const sibling = join(dirname(sourcePath), basename(rawPath));
    await Deno.stat(join(REPO_ROOT, sibling));
    return sibling;
  }
}

Deno.test("refactor-inventory-reconciled: every frozen row names a real symbol, caller and test", async () => {
  const plan = await Deno.readTextFile(PLAN_PATH);
  const section = plan.split("## Refactoring inventory")[1].split("\n## ")[0];
  const rows = section.split("\n").filter((line) => /^\| \d+/.test(line)).map((line) =>
    line.split("|").map((cell) => cell.trim())
  );
  assertEquals(rows.length, 26);
  for (const row of rows) {
    const step = row[1];
    const source = row[2];
    const values = row[4];
    const caller = row[5];
    const anchor = row[6];
    const sourceMatch = /^`([^`:]+):([^`]+)`$/.exec(source);
    assert(sourceMatch !== null, `row ${step} has an unparsed source: ${source}`);
    const [, sourcePath, symbol] = sourceMatch;
    const baseSymbol = symbol.split("::")[0];
    const identifier = baseSymbol.split(".").pop() ?? baseSymbol;
    const sourceText = await Deno.readTextFile(join(REPO_ROOT, sourcePath));
    assert(sourceText.includes(identifier), `row ${step}: '${identifier}' is not in ${sourcePath}`);

    const frozen = /^(\d+) \/ (\d+)$/.exec(values);
    assert(frozen !== null, `row ${step} does not carry frozen core values: ${values}`);
    assert(
      Number(frozen[1]) > 20 || Number(frozen[2]) > 30,
      `row ${step} is below the tranche thresholds: ${values}`,
    );

    const backticked = [...caller.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const callerPath = backticked.find((entry) => entry.includes(".ts"));
    if (callerPath === undefined) {
      const names = [...caller.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]);
      assert(names.length > 0, `row ${step} has no named caller`);
      let named = false;
      for (const name of names) {
        if (await symbolExistsNear(name, sourcePath)) {
          named = true;
          break;
        }
      }
      assert(named, `row ${step}: caller '${caller}' names no symbol near ${sourcePath}`);
    } else {
      const tsEnd = callerPath.indexOf(".ts") + 3;
      const rawPath = callerPath.slice(0, tsEnd);
      const route = callerPath.slice(tsEnd).replace(/^[:\s→-]+/, "");
      const path = await resolveCallerPath(rawPath, sourcePath);
      const dotted = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/.exec(route);
      if (dotted !== null) {
        const callerText = await Deno.readTextFile(join(REPO_ROOT, path));
        const routeName = dotted[1].split(".").pop() ?? dotted[1];
        assert(callerText.includes(routeName), `row ${step}: caller '${routeName}' is not in ${path}`);
      }
    }

    const anchorPath = [...anchor.matchAll(/`([^`]+)`/g)].map((match) => match[1]).find((entry) =>
      entry.endsWith(".ts")
    );
    assert(anchorPath !== undefined, `row ${step} has no test anchor path`);
    await Deno.stat(join(REPO_ROOT, anchorPath));
  }
});

/** The tree is shared with tests that write a scratch file, so one rerun absorbs a file that vanished mid-scan. */
async function withTransientTreeRetry(run: () => Promise<Deno.CommandOutput>): Promise<Deno.CommandOutput> {
  const first = await run();
  return first.success ? first : await run();
}

Deno.test("compare-complexity-live: the installed fallow binary calibrates the repository", {
  ignore: !(await fallowAvailable()),
}, async () => {
  const result = await withTransientTreeRetry(() =>
    new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-run=fallow",
        "--allow-env",
        join(REPO_ROOT, "packages/lint-policy/src/tools/compare_complexity.ts"),
        "--json",
      ],
      cwd: REPO_ROOT,
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "piped",
    }).output()
  );
  const stdout = new TextDecoder().decode(result.stdout);
  assertEquals(result.code, 0, `${new TextDecoder().decode(result.stderr)}\n${stdout.slice(0, 4000)}`);
  const comparison = JSON.parse(stdout) as {
    populations: { common_files: number; matched: number; core_parse_failures: number };
    sufficient: boolean;
    coverage: { fallow: number; core: number };
  };
  assertEquals(comparison.sufficient, true);
  assertEquals(comparison.populations.common_files > 0, true);
  assertEquals(comparison.populations.matched > 0, true);
  assertEquals(comparison.populations.core_parse_failures, 0);
  console.log(
    `live calibration: ${comparison.populations.matched} matches over ` +
      `${comparison.populations.common_files} common files, coverage ` +
      `${(comparison.coverage.fallow * 100).toFixed(2)}% / ${(comparison.coverage.core * 100).toFixed(2)}%`,
  );
});

/** True when the pinned fallow binary is installed and runnable. */
async function fallowAvailable(): Promise<boolean> {
  try {
    const result = await new Deno.Command("fallow", {
      args: ["--version"],
      env: { LD_LIBRARY_PATH: "" },
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  } catch {
    return false;
  }
}
