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
import { collectFunctionRows, type IHealthContribution, type IMeasuredFunction } from "@dostark/unslop-ts/report";

/** The fallow JSON schema this calibration accepts. */
const FALLOW_SCHEMA_VERSION = 12;

/** The fallow version this calibration accepts. */
const FALLOW_VERSION = "3.36.0";

/** The matching coverage each population needs before the exactness rate is meaningful. */
const REQUIRED_COVERAGE = 0.99;

/** The exact cyclomatic agreement the plan targets. */
const REQUIRED_EXACT_AGREEMENT = 0.95;

/** The measured defaults the calibration counts with. */
const DEFAULT_SETTINGS = {
  maxCrap: 30,
  maxCyclomatic: 15,
  maxCognitive: 15,
  maxLines: 60,
  variant: "extended" as const,
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

/** One contribution row of a fallow finding. */
export interface IFallowContribution {
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
export interface IMatchedPair {
  readonly fallow: IFallowFinding;
  readonly core: IMeasuredFunction;
}

/** One function row that only one tool reported. */
export interface IUnmatchedRow {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly col: number;
}

/** The outcome of matching both populations by normalized position. */
export interface IMatchResult {
  readonly matched: readonly IMatchedPair[];
  readonly fallowOnly: readonly IFallowFinding[];
  readonly coreOnly: readonly IMeasuredFunction[];
  readonly ambiguous: readonly { readonly key: string; readonly fallow: number; readonly core: number }[];
}

/** The difference categories of one matched pair. */
export interface IContributionDifference {
  readonly metric: string;
  readonly kind: string;
  readonly fallow: number;
  readonly core: number;
}

/** One matched pair whose values or kinds differ. */
export interface IDifference {
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

/** The complete comparison result. */
export interface IComparison {
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
  readonly coverage: { readonly fallow: number; readonly core: number };
  readonly exact: {
    readonly cyclomatic: { readonly equal: number; readonly percent: number };
    readonly cognitive: { readonly equal: number; readonly percent: number };
  };
  readonly sufficient: boolean;
  readonly differences: readonly IDifference[];
}

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

/** Compares a validated fallow report with the engine rows over the files both tools measured. */
export function compareComplexity(
  report: IFallowReport,
  core: readonly IMeasuredFunction[],
  coreParseFailures = 0,
): IComparison {
  const fallowPaths = new Set(report.findings.map((finding) => normalizePath(finding.path)));
  const corePaths = new Set(core.map((row) => normalizePath(row.path)));
  const commonPaths = new Set([...fallowPaths].filter((path) => corePaths.has(path)));
  const scopedFallow = report.findings.filter((finding) => commonPaths.has(normalizePath(finding.path)));
  const scoped = core.filter((row) => commonPaths.has(normalizePath(row.path)));
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
      fallow: match.fallowOnly.slice(0, SAMPLE_SIZE),
      core: match.coreOnly.slice(0, SAMPLE_SIZE),
    },
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

/** Parses the JSON text into an object, or fails with a named error. */
function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CompareError(`fallow output is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value === null || typeof value !== "object") throw new CompareError("fallow output is not an object");
  return value as Record<string, unknown>;
}

/** Refuses a report whose kind, schema or tool version is not the pinned one. */
function assertFallowHeader(report: Record<string, unknown>): void {
  if (report.kind !== "health") throw new CompareError(`fallow output kind '${String(report.kind)}' is not health`);
  if (report.schema_version !== FALLOW_SCHEMA_VERSION) {
    throw new CompareError(`fallow schema ${String(report.schema_version)} is not ${FALLOW_SCHEMA_VERSION}`);
  }
  if (report.version !== FALLOW_VERSION) {
    throw new CompareError(`fallow version '${String(report.version)}' is not ${FALLOW_VERSION}`);
  }
}

/** Validates one finding and reads its measured fields. */
function findingOf(entry: unknown): IFallowFinding {
  if (entry === null || typeof entry !== "object") throw new CompareError("fallow finding is not an object");
  const finding = entry as Record<string, unknown>;
  if (typeof finding.path !== "string" || typeof finding.name !== "string") {
    throw new CompareError("fallow finding is missing its path or name");
  }
  if (typeof finding.line !== "number" || typeof finding.col !== "number") {
    throw new CompareError("fallow finding is missing its position");
  }
  const contributions = Array.isArray(finding.contributions)
    ? finding.contributions as readonly IFallowContribution[]
    : undefined;
  return {
    path: finding.path,
    name: finding.name,
    line: finding.line,
    col: finding.col,
    cyclomatic: Number(finding.cyclomatic),
    cognitive: Number(finding.cognitive),
    ...(contributions === undefined ? {} : { contributions }),
  };
}

/** Validates the nonempty findings list. */
function findingsOf(value: unknown): readonly IFallowFinding[] {
  if (!Array.isArray(value)) throw new CompareError("fallow output has no findings array");
  if (value.length === 0) throw new CompareError("fallow reported an empty function population");
  return value.map(findingOf);
}

/** Validates the fallow report shape, version and schema before any comparison. */
export function parseFallowReport(text: string): IFallowReport {
  const report = parseJsonObject(text);
  assertFallowHeader(report);
  return {
    kind: "health",
    schema_version: FALLOW_SCHEMA_VERSION,
    version: FALLOW_VERSION,
    findings: findingsOf(report.findings),
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
    });
    const comparison = compareComplexity(report, collection.rows, collection.errors.length);
    console.log(asJson ? `${JSON.stringify(comparison, null, 2)}\n` : `${renderText(comparison)}\n`);
    if (!comparison.sufficient) Deno.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`compare-complexity: ${message}\n`);
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
