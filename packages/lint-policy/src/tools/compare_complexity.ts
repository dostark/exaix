#!/usr/bin/env -S deno run -A
/**
 * @module CompareComplexity
 * @path packages/lint-policy/src/tools/compare_complexity.ts
 * @description Advisory calibration of the engine's complexity metrics against a pinned fallow binary.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [scripts/compare_unused_exports.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run --allow-read --allow-run=fallow --allow-env \
 *     packages/lint-policy/src/tools/compare_complexity.ts [--root=.] [--json]
 */

import { join } from "@std/path";
import {
  collectFunctionRows,
  type IHealthContribution,
  type IHealthSettings,
  type IMeasuredFunction,
} from "@dostark/unslop-ts/report";
import { z } from "zod";

/** One contribution row of a fallow finding. */
interface IFallowContribution {
  readonly line: number;
  readonly col: number;
  readonly metric: string;
  readonly kind: string;
  readonly weight: number;
  readonly nesting: number;
}

/** One fallow complexity finding. */
export interface IFallowFinding {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly col: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly contributions?: readonly IFallowContribution[];
}

/** The fallow health report the calibration reads. */
export interface IFallowReport {
  readonly kind: string;
  readonly schema_version: number;
  readonly version: string;
  readonly findings: readonly IFallowFinding[];
}

/** One matched function pair. */
interface IMatchedPair {
  readonly fallow: IFallowFinding;
  readonly core: IMeasuredFunction;
}

/** One function row that only one tool reported. */
interface IUnmatchedRow {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly col: number;
}

/** The outcome of matching both populations by normalized position. */
interface IMatchResult {
  readonly matched: readonly IMatchedPair[];
  readonly fallowOnly: readonly IFallowFinding[];
  readonly coreOnly: readonly IMeasuredFunction[];
  readonly ambiguous: readonly { readonly key: string; readonly fallow: number; readonly core: number }[];
}

/** The difference categories of one matched pair. */
interface IContributionDifference {
  readonly metric: string;
  readonly kind: string;
  readonly fallow: number;
  readonly core: number;
}

/** One matched pair whose values or kinds differ. */
interface IDifference {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly col: number;
  readonly fallow_cyclomatic: number;
  readonly core_cyclomatic: number;
  readonly fallow_cognitive: number;
  readonly core_cognitive: number;
  readonly contributions: readonly IContributionDifference[];
}

/** The two tools whose populations the calibration compares. */
type ExclusionTool = "fallow" | "core";

/** One justified subject that leaves a tool's population: a file, or a directory when the path ends in a slash. */
export interface IExclusion {
  readonly tool: ExclusionTool;
  readonly path: string;
  readonly reason: string;
}

/** One exclusion with the functions it removed, so the accounting stays complete. */
interface IExclusionAccount extends IExclusion {
  readonly files: readonly string[];
  readonly functions: number;
}

/** The complete comparison result. */
interface IComparison {
  readonly fallow_version: string;
  readonly schema_version: number;
  readonly populations: {
    readonly fallow_files: number;
    readonly core_files: number;
    readonly common_files: number;
    readonly fallow: number;
    readonly core: number;
    readonly fallow_outside_snapshot: number;
    readonly core_outside_fallow: number;
    readonly core_parse_failures: number;
    readonly matched: number;
    readonly unmatched_fallow: number;
    readonly unmatched_core: number;
    readonly ambiguous: number;
  };
  readonly unmatched_samples: {
    readonly fallow: readonly IUnmatchedRow[];
    readonly core: readonly IUnmatchedRow[];
  };
  /** Every unmatched and ambiguous identity, beyond the display samples. */
  readonly unmatched: {
    readonly fallow: readonly IUnmatchedRow[];
    readonly core: readonly IUnmatchedRow[];
    readonly ambiguous: readonly { readonly key: string; readonly fallow: number; readonly core: number }[];
  };
  readonly exclusions: readonly IExclusionAccount[];
  readonly coverage: { readonly fallow: number; readonly core: number };
  readonly exact: {
    readonly cyclomatic: { readonly equal: number; readonly percent: number };
    readonly cognitive: { readonly equal: number; readonly percent: number };
  };
  readonly sufficient: boolean;
  readonly differences: readonly IDifference[];
}

/** The fallow JSON schema this calibration accepts. */
const FALLOW_SCHEMA_VERSION = 12;

/** The fallow version this calibration accepts. */
const FALLOW_VERSION = "3.36.0";

const TOOL_FALLOW: ExclusionTool = "fallow";
const TOOL_CORE: ExclusionTool = "core";

/** The matching coverage each population needs before the exactness rate is meaningful. */
const REQUIRED_COVERAGE = 0.99;

/** The exact cyclomatic agreement the plan targets. */
const REQUIRED_EXACT_AGREEMENT = 0.95;

/** The subjects the calibration leaves out of a population, each with a stated reason. */
export const CALIBRATION_EXCLUSIONS: readonly IExclusion[] = [
  {
    tool: TOOL_FALLOW,
    path: "tests/scenario_framework/fixtures/",
    reason: "Scenario fixture projects are test data, and the two tools scan different fixture files.",
  },
  {
    tool: TOOL_CORE,
    path: "tests/scenario_framework/fixtures/",
    reason: "Scenario fixture projects are test data, and the two tools scan different fixture files.",
  },
  {
    tool: TOOL_CORE,
    path: "lint/unslop/unslop_engine.js",
    reason: "A generated engine bundle that the fallow run does not report.",
  },
  {
    tool: TOOL_CORE,
    path: ".cache/",
    reason: "A local scratch cache, not tracked source.",
  },
  {
    tool: TOOL_CORE,
    path: "exaix-dev-docs/evidence/",
    reason: "Evidence probes in the plan submodule that the fallow run does not scan.",
  },
  {
    tool: TOOL_CORE,
    path: "tests/scenario_framework/output/",
    reason: "Generated scenario output that the fallow run does not scan.",
  },
];

/** The measured defaults the calibration counts with. */
const DEFAULT_SETTINGS: IHealthSettings = {
  maxCrap: 30,
  maxCyclomatic: 15,
  maxCognitive: 15,
  maxLines: 60,
  variant: "extended",
  countNullish: true,
};

/** The fallow arguments the calibration fixes. */
const FALLOW_ARGS: readonly string[] = [
  "health",
  "--report-only",
  "--complexity",
  "--max-cyclomatic",
  "0",
  "--max-cognitive",
  "0",
  "--max-crap",
  "0",
  "--complexity-breakdown",
  "--format=json",
];

/** A calibration failure that is not a metric disagreement. */
export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareError";
  }
}

/** The repository-relative POSIX form of a path. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** The position key both tools share: path, one-based line and zero-based column. */
function matchKeyOf(row: { readonly path: string; readonly line: number; readonly col: number }): string {
  return `${normalizePath(row.path)}:${row.line}:${row.col}`;
}

/** The byte-column key of one engine row, which shares the external report's column base. */
export function coreKeyOf(row: IMeasuredFunction): string {
  return `${normalizePath(row.path)}:${row.line}:${row.byte_col}`;
}

/** Groups rows by their position key. */
function groupByKey<T extends { readonly path: string; readonly line: number; readonly col: number }>(
  rows: readonly T[],
  keyOf: (row: T) => string = matchKeyOf,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

/** Matches the two populations by position. A shared key with more than one row is ambiguous. */
export function matchFunctions(
  fallow: readonly IFallowFinding[],
  core: readonly IMeasuredFunction[],
): IMatchResult {
  const fallowGroups = groupByKey(fallow);
  const coreGroups = groupByKey(core, coreKeyOf);
  const keys = [...new Set([...fallowGroups.keys(), ...coreGroups.keys()])].sort((left, right) =>
    left.localeCompare(right)
  );
  const matched: IMatchedPair[] = [];
  const fallowOnly: IFallowFinding[] = [];
  const coreOnly: IMeasuredFunction[] = [];
  const ambiguous: { key: string; fallow: number; core: number }[] = [];
  for (const key of keys) {
    const left = fallowGroups.get(key) ?? [];
    const right = coreGroups.get(key) ?? [];
    if (left.length === 1 && right.length === 1) {
      matched.push({ fallow: left[0], core: right[0] });
      continue;
    }
    if (left.length > 1 || right.length > 1) {
      ambiguous.push({ key, fallow: left.length, core: right.length });
      continue;
    }
    fallowOnly.push(...left);
    coreOnly.push(...right);
  }
  return { matched, fallowOnly, coreOnly, ambiguous };
}

/** Counts contributions by metric and kind. */
function countKinds(contributions: readonly (IFallowContribution | IHealthContribution)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of contributions) {
    const key = `${entry.metric}:${entry.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The contribution kinds whose counts differ between the two tools. */
function contributionDifferences(
  fallow: readonly IFallowContribution[],
  core: readonly IHealthContribution[],
): IContributionDifference[] {
  const left = countKinds(fallow);
  const right = countKinds(core);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b));
  const differences: IContributionDifference[] = [];
  for (const key of keys) {
    const [metric, kind] = key.split(":");
    const fallowCount = left.get(key) ?? 0;
    const coreCount = right.get(key) ?? 0;
    if (fallowCount === coreCount) continue;
    differences.push({ metric, kind, fallow: fallowCount, core: coreCount });
  }
  return differences;
}

/** The share of `matched` in `population`, zero for an empty population. */
function coverageOf(matched: number, population: number): number {
  return population === 0 ? 0 : matched / population;
}

/** The first few unmatched rows, for attribution in the report. */
const SAMPLE_SIZE = 10;

/** Rejects an exclusion without a path or a stated reason. */
function assertExclusions(exclusions: readonly IExclusion[]): void {
  for (const exclusion of exclusions) {
    if (exclusion.path.trim() === "" || exclusion.reason.trim() === "") {
      throw new CompareError(`an exclusion needs a path and a reason: '${exclusion.path}'`);
    }
  }
}

/** True when the exclusion names the file: the exact path, or a directory prefix. */
function excludes(exclusion: IExclusion, path: string): boolean {
  const normalized = normalizePath(path);
  return exclusion.path.endsWith("/") ? normalized.startsWith(exclusion.path) : normalized === exclusion.path;
}

/** Splits one tool's rows into the kept population and the per-exclusion accounts. */
function applyExclusions<T extends { readonly path: string }>(
  tool: ExclusionTool,
  rows: readonly T[],
  exclusions: readonly IExclusion[],
): { kept: T[]; accounts: IExclusionAccount[] } {
  const own = exclusions.filter((exclusion) => exclusion.tool === tool);
  const files = new Map<IExclusion, Map<string, number>>();
  const kept: T[] = [];
  for (const row of rows) {
    const hit = own.find((exclusion) => excludes(exclusion, row.path));
    if (hit === undefined) {
      kept.push(row);
      continue;
    }
    const counts = files.get(hit) ?? new Map<string, number>();
    counts.set(normalizePath(row.path), (counts.get(normalizePath(row.path)) ?? 0) + 1);
    files.set(hit, counts);
  }
  const accounts = own.map((exclusion): IExclusionAccount => {
    const counts = files.get(exclusion) ?? new Map<string, number>();
    return {
      ...exclusion,
      files: [...counts.keys()].sort((left, right) => left.localeCompare(right)),
      functions: [...counts.values()].reduce((sum, count) => sum + count, 0),
    };
  });
  return { kept, accounts };
}

/** The identity of one unmatched row. */
function unmatchedRowOf(
  row: { readonly path: string; readonly name: string; readonly line: number; readonly col: number },
): IUnmatchedRow {
  return { path: normalizePath(row.path), name: row.name, line: row.line, col: row.col };
}

/** Compares the full populations of both tools. Only the listed exclusions leave a population. */
export function compareComplexity(
  report: IFallowReport,
  core: readonly IMeasuredFunction[],
  coreParseFailures = 0,
  exclusions: readonly IExclusion[] = CALIBRATION_EXCLUSIONS,
): IComparison {
  assertExclusions(exclusions);
  const fallowKept = applyExclusions(TOOL_FALLOW, report.findings, exclusions);
  const coreKept = applyExclusions(TOOL_CORE, core, exclusions);
  const scopedFallow = fallowKept.kept;
  const scoped = coreKept.kept;
  const fallowPaths = new Set(scopedFallow.map((finding) => normalizePath(finding.path)));
  const corePaths = new Set(scoped.map((row) => normalizePath(row.path)));
  const commonPaths = new Set([...fallowPaths].filter((path) => corePaths.has(path)));
  const match = matchFunctions(scopedFallow, scoped);
  const differences: IDifference[] = [];
  let equalCyclomatic = 0;
  let equalCognitive = 0;
  for (const pair of match.matched) {
    if (pair.fallow.cyclomatic === pair.core.cyclomatic) equalCyclomatic++;
    if (pair.fallow.cognitive === pair.core.cognitive) equalCognitive++;
    const kinds = contributionDifferences(pair.fallow.contributions ?? [], pair.core.contributions);
    if (
      pair.fallow.cyclomatic === pair.core.cyclomatic && pair.fallow.cognitive === pair.core.cognitive &&
      kinds.length === 0
    ) continue;
    differences.push({
      path: normalizePath(pair.core.path),
      name: pair.core.name,
      line: pair.core.line,
      col: pair.core.col,
      fallow_cyclomatic: pair.fallow.cyclomatic,
      core_cyclomatic: pair.core.cyclomatic,
      fallow_cognitive: pair.fallow.cognitive,
      core_cognitive: pair.core.cognitive,
      contributions: kinds,
    });
  }
  const matched = match.matched.length;
  const fallowCoverage = coverageOf(matched, scopedFallow.length);
  const coreCoverage = coverageOf(matched, scoped.length);
  return {
    fallow_version: report.version,
    schema_version: report.schema_version,
    populations: {
      fallow_files: fallowPaths.size,
      core_files: corePaths.size,
      common_files: commonPaths.size,
      fallow: scopedFallow.length,
      core: scoped.length,
      fallow_outside_snapshot: report.findings.length - scopedFallow.length,
      core_outside_fallow: core.length - scoped.length,
      core_parse_failures: coreParseFailures,
      matched,
      unmatched_fallow: match.fallowOnly.length,
      unmatched_core: match.coreOnly.length,
      ambiguous: match.ambiguous.length,
    },
    unmatched_samples: {
      fallow: match.fallowOnly.slice(0, SAMPLE_SIZE).map(unmatchedRowOf),
      core: match.coreOnly.slice(0, SAMPLE_SIZE).map(unmatchedRowOf),
    },
    unmatched: {
      fallow: match.fallowOnly.map(unmatchedRowOf),
      core: match.coreOnly.map(unmatchedRowOf),
      ambiguous: match.ambiguous,
    },
    exclusions: [...fallowKept.accounts, ...coreKept.accounts],
    coverage: { fallow: fallowCoverage, core: coreCoverage },
    exact: {
      cyclomatic: {
        equal: equalCyclomatic,
        percent: matched === 0 ? 0 : (equalCyclomatic / matched) * 100,
      },
      cognitive: {
        equal: equalCognitive,
        percent: matched === 0 ? 0 : (equalCognitive / matched) * 100,
      },
    },
    sufficient: matched > 0 && fallowCoverage >= REQUIRED_COVERAGE && coreCoverage >= REQUIRED_COVERAGE &&
      coreParseFailures === 0 && match.ambiguous.length === 0 &&
      equalCyclomatic / Math.max(matched, 1) >= REQUIRED_EXACT_AGREEMENT,
    differences,
  };
}

/** Runs the pinned fallow binary and returns its parsed report. */
async function runFallow(root: string): Promise<IFallowReport> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("fallow", {
      args: [...FALLOW_ARGS],
      cwd: root,
      // See scripts/commit_plan_step.ts for why LD_LIBRARY_PATH is scrubbed here.
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    throw new CompareError(`cannot run fallow: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (output.code !== 0) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new CompareError(`fallow exited ${output.code}: ${stderr}`);
  }
  return parseFallowReport(new TextDecoder().decode(output.stdout));
}

/** The contribution row schema of one fallow finding. */
const FallowContributionSchema = z.object({
  line: z.number(),
  col: z.number(),
  metric: z.string(),
  kind: z.string(),
  weight: z.number(),
  nesting: z.number(),
});

/** The finding schema of the fallow report. */
const FallowFindingSchema = z.object({
  path: z.string(),
  name: z.string(),
  line: z.number(),
  col: z.number(),
  cyclomatic: z.number(),
  cognitive: z.number(),
  contributions: z.array(FallowContributionSchema).optional(),
});

/** The fallow report schema, with every field the comparison reads. */
const FallowReportSchema = z.object({
  kind: z.literal("health"),
  schema_version: z.number(),
  version: z.string(),
  findings: z.array(FallowFindingSchema),
});

type TFallowReport = z.infer<typeof FallowReportSchema>;

/** Validates the fallow report shape, version and schema before any comparison. */
export function parseFallowReport(text: string): IFallowReport {
  let parsed: TFallowReport;
  try {
    parsed = FallowReportSchema.parse(JSON.parse(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CompareError(`fallow output is invalid: ${message}`);
  }
  if (parsed.schema_version !== FALLOW_SCHEMA_VERSION) {
    throw new CompareError(`fallow schema ${String(parsed.schema_version)} is not ${FALLOW_SCHEMA_VERSION}`);
  }
  if (parsed.version !== FALLOW_VERSION) {
    throw new CompareError(`fallow version '${parsed.version}' is not ${FALLOW_VERSION}`);
  }
  if (parsed.findings.length === 0) throw new CompareError("fallow reported an empty function population");
  return {
    kind: "health",
    schema_version: FALLOW_SCHEMA_VERSION,
    version: FALLOW_VERSION,
    findings: parsed.findings,
  };
}

/** The text view of one comparison. */
function renderText(comparison: IComparison): string {
  const populations = comparison.populations;
  return [
    `fallow ${comparison.fallow_version} (schema ${comparison.schema_version})`,
    `files: fallow ${populations.fallow_files}, core ${populations.core_files}, ` +
    `common ${populations.common_files}`,
    `populations: fallow ${populations.fallow}, core ${populations.core}, matched ${populations.matched}, ` +
    `fallow-only ${populations.unmatched_fallow}, core-only ${populations.unmatched_core}, ` +
    `ambiguous ${populations.ambiguous}, fallow outside snapshot ${populations.fallow_outside_snapshot}, ` +
    `core outside fallow ${populations.core_outside_fallow}, core parse failures ` +
    `${populations.core_parse_failures}`,
    `coverage: fallow ${(comparison.coverage.fallow * 100).toFixed(1)}%, ` +
    `core ${(comparison.coverage.core * 100).toFixed(1)}%`,
    `exact cyclomatic: ${comparison.exact.cyclomatic.equal}/${populations.matched} ` +
    `(${comparison.exact.cyclomatic.percent.toFixed(2)}%)`,
    `exact cognitive: ${comparison.exact.cognitive.equal}/${populations.matched} ` +
    `(${comparison.exact.cognitive.percent.toFixed(2)}%)`,
    `differences: ${comparison.differences.length} (displayed below, up to ten)`,
    ...comparison.differences.slice(0, 10).map((difference) =>
      `  ${difference.path}:${difference.line} ${difference.name} — cyclomatic ` +
      `${difference.fallow_cyclomatic}/${difference.core_cyclomatic}, cognitive ` +
      `${difference.fallow_cognitive}/${difference.core_cognitive}`
    ),
  ].join("\n");
}

/** Runs the calibration command. Disagreement exits 0. Execution, schema or population failure exits 1. */
async function main(): Promise<void> {
  const args = Deno.args;
  const rootFlag = args.find((arg) => arg.startsWith("--root="))?.slice("--root=".length);
  const root = rootFlag === undefined ? Deno.cwd() : join(Deno.cwd(), rootFlag);
  const asJson = args.includes("--json");
  try {
    const report = await runFallow(root);
    const collection = await collectFunctionRows({
      rootPath: root,
      ignoreGlobs: [],
      scopes: { test: [], fixture: [] },
      settings: DEFAULT_SETTINGS,
      sort: "cyclomatic",
      coverageText: null,
      coverageSha256: null,
      coverageManifest: null,
      testGlobs: [],
      sinceEpoch: 0,
      minCommits: 3,
      nowEpoch: 0,
      duplication: null,
      duplicateRunner: null,
      fileLines: null,
      publicEntries: [],
    });
    const comparison = compareComplexity(report, collection.rows, collection.errors.length, CALIBRATION_EXCLUSIONS);
    console.log(asJson ? `${JSON.stringify(comparison, null, 2)}\n` : `${renderText(comparison)}\n`);
    if (!comparison.sufficient) Deno.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`compare-complexity: ${message}\n`);
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
