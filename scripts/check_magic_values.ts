#!/usr/bin/env -S deno run -A
/**
 * @module CheckMagicValues
 * @path scripts/check_magic_values.ts
 * @description Magic Value Detector — scans TypeScript sources using the compiler API
 * AST to find repeated string/number literals that should be extracted
 * into named constants or enums.
 *
 * Usage:
 *   deno run -A scripts/check_magic_values.ts          # strings + numbers
 *   deno run -A scripts/check_magic_values.ts --no-numbers  # strings only
 *   deno run -A scripts/check_magic_values.ts --include-tests  # include tests
 *
 * Thresholds (per-module / global):
 *   strings:  occurrences > 3  (local)  / > 5  (global)
 *   numbers:  occurrences > 4  (local)  / > 6  (global)
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = new Set(Deno.args);
const checkNumbers = !args.has("--no-numbers") && !args.has("--strings-only");
const includeTests = args.has("--include-tests");

function getNumericFlagValue(flag: string): number | undefined {
  const prefix = `${flag}=`;
  for (const arg of Deno.args) {
    if (arg.startsWith(prefix)) {
      const raw = arg.slice(prefix.length).trim();
      if (raw.length === 0) {
        console.error(`Invalid value for ${flag}: value is required`);
        Deno.exit(1);
      }

      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        console.error(`Invalid value for ${flag}: ${raw} (expected non-negative integer)`);
        Deno.exit(1);
      }

      return parsed;
    }
  }
  return undefined;
}

if (args.has("--help") || args.has("-h")) {
  console.log(`Magic Value Detector

Usage:
  deno run -A scripts/check_magic_values.ts [options]

Options:
  --no-numbers, --strings-only  Skip number literal checks (strings only)
  --include-tests               Include test files in scan (default: false)
  --local-string-threshold=N    Local threshold for string literals (default: 3)
  --global-string-threshold=N   Global threshold for string literals (default: 5)
  --local-number-threshold=N    Local threshold for number literals (default: 4)
  --global-number-threshold=N   Global threshold for number literals (default: 6)
  --help, -h                    Show this help message

Thresholds (occurrences that trigger a violation):
  Strings  — local: > 3  |  global: > 5
  Numbers  — local: > 4  |  global: > 6

Output is sorted by:
  1. Candidate score (descending)
  2. Scope (GLOBAL before MODULE)
  3. Number of distinct files affected (descending)
  4. Total occurrences (descending)

For each violation, a per-file breakdown is shown.
`);
  Deno.exit(0);
}

// ── Configuration ────────────────────────────────────────────────────────────

const LOCAL_STRING_THRESHOLD = 3;
const GLOBAL_STRING_THRESHOLD = 5;
const LOCAL_NUMBER_THRESHOLD = 4;
const GLOBAL_NUMBER_THRESHOLD = 6;

const localStringThreshold = getNumericFlagValue("--local-string-threshold") ??
  LOCAL_STRING_THRESHOLD;
const globalStringThreshold = getNumericFlagValue("--global-string-threshold") ??
  GLOBAL_STRING_THRESHOLD;
const localNumberThreshold = getNumericFlagValue("--local-number-threshold") ??
  LOCAL_NUMBER_THRESHOLD;
const globalNumberThreshold = getNumericFlagValue("--global-number-threshold") ??
  GLOBAL_NUMBER_THRESHOLD;

const STRING_WHITELIST = new Set([
  "",
  " ",
  "\n",
  "\t",
  "\\n",
  "\\t",
  "true",
  "false",
  "null",
  "undefined",
  // typeof checks — these are structural, not magic values
  "string",
  "number",
  "boolean",
  "object",
  "function",
  "undefined",
  "symbol",
  "bigint",
  "unknown",
  "any",
  "never",
  "void",
  // Common English words that appear in stop-word lists across the codebase
  "other",
]);
const NUMBER_WHITELIST = new Set([0, 1, -1]);

/** Skip numbers below this threshold (below 100 are usually indices, counts, small offsets) */
const MIN_NUMBER_THRESHOLD = 100;

/** Skip strings shorter than this length */
const SHORT_STRING_MIN_LENGTH = 4;

/** Skip strings that look like constant names or env vars (all uppercase with underscores/digits) */
const ALL_CAPS_REGEX = /^[A-Z][A-Z0-9_]*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FILE_OR_PATH_REGEX = /[\\/]|\.[A-Za-z0-9]{1,8}$/;
const CLI_FLAG_REGEX = /^--?[a-z0-9][a-z0-9-]*$/i;
const MIME_TYPE_REGEX = /^[a-z]+\/[a-z0-9.+-]+$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_WITH_NUMERIC_SUFFIX_REGEX = /^[a-z][a-z0-9_-]*[-_][0-9]+$/i;
const STDIO_PIPE_FIELD_NAMES = new Set(["stdout", "stderr", "stdin"]);
const STRUCTURAL_METADATA_PROPERTY_NAMES = new Set([
  "description",
  "title",
  "label",
  "placeholder",
]);
const STRUCTURAL_STRING_ARRAY_PROPERTY_NAMES = new Set([
  "args",
  "enum",
  "capabilities",
  "tags",
]);

const ROUND_NUMBER_STEP = 50;
const ROUND_NUMBER_MAX = 1_000;
const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;

const SCORE_SCOPE_GLOBAL_BONUS = 25;
const SCORE_SCOPE_LOCAL_BONUS = 10;
const SCORE_PER_OCCURRENCE = 3;
const SCORE_PER_DISTINCT_FILE = 5;
const SCORE_EXISTING_CONSTANT_BONUS = 40;

function isTestFilePath(filePath: string): boolean {
  return filePath.includes("/tests/") || filePath.endsWith("_test.ts") || filePath.endsWith("_test.tsx");
}

function isConstantOrEnumFilePath(filePath: string): boolean {
  return filePath.endsWith("constants.ts") || filePath.endsWith("enums.ts");
}

function isLikelyStructuralString(value: string): boolean {
  return UUID_REGEX.test(value) ||
    SEMVER_REGEX.test(value) ||
    FILE_OR_PATH_REGEX.test(value) ||
    CLI_FLAG_REGEX.test(value) ||
    MIME_TYPE_REGEX.test(value) ||
    EMAIL_REGEX.test(value) ||
    ID_WITH_NUMERIC_SUFFIX_REGEX.test(value);
}

function isLikelyStructuralNumber(value: number): boolean {
  if (value >= HTTP_STATUS_MIN && value <= HTTP_STATUS_MAX) {
    return true;
  }

  if (value % ROUND_NUMBER_STEP === 0 && value <= ROUND_NUMBER_MAX) {
    return true;
  }

  return false;
}

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

// ── Data structures ──────────────────────────────────────────────────────────

type LiteralKind = "string" | "number";
type ViolationScope = "global" | "local";

interface FileBreakdown {
  /** Relative path from repo root */
  file: string;
  count: number;
  firstLine: number;
}

interface Violation {
  value: string;
  kind: LiteralKind;
  scope: ViolationScope;
  totalOccurrences: number;
  distinctFiles: number;
  score: number;
  hasExistingConstantCandidate: boolean;
  /** Per-file breakdown, sorted by count descending */
  files: FileBreakdown[];
}

// ── Counting data (accumulated during AST walk) ──────────────────────────────

/**
 * Accumulated counters keyed by `"string:literal"` or `"number:42"`.
 */
interface ValueAccumulator {
  value: string;
  kind: LiteralKind;
  /** All occurrences across the whole codebase */
  occurrences: Array<{ file: string; line: number }>;
  /** Per-file counts */
  perFile: Map<string, number>;
}

// ── AST Visitor ──────────────────────────────────────────────────────────────

/**
 * Should this literal be skipped (whitelisted or irrelevant context)?
 */
function shouldSkip(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return true;

  // Skip property names in object literals: { foo: "bar" } — "foo" is a name
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;

  // Skip stdio mode literals in command options: { stdout: "piped" }
  if (
    ts.isStringLiteral(node) &&
    node.text === "piped" &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node
  ) {
    const propName = ts.isIdentifier(parent.name)
      ? parent.name.text
      : ts.isStringLiteral(parent.name)
      ? parent.name.text
      : "";
    if (STDIO_PIPE_FIELD_NAMES.has(propName)) return true;
  }

  // Skip structural content type tags used by MCP payloads: { type: "text" }
  if (
    ts.isStringLiteral(node) &&
    node.text === "text" &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node
  ) {
    const propName = ts.isIdentifier(parent.name)
      ? parent.name.text
      : ts.isStringLiteral(parent.name)
      ? parent.name.text
      : "";
    if (propName === "type") return true;
  }

  // Skip JSON-schema required field names: required: ["portal", "path", ...]
  if (ts.isStringLiteral(node) && ts.isArrayLiteralExpression(parent)) {
    const maybeRequiredProp = parent.parent;
    if (ts.isPropertyAssignment(maybeRequiredProp) && maybeRequiredProp.initializer === parent) {
      const propName = ts.isIdentifier(maybeRequiredProp.name)
        ? maybeRequiredProp.name.text
        : ts.isStringLiteral(maybeRequiredProp.name)
        ? maybeRequiredProp.name.text
        : "";
      if (propName === "required") return true;
      if (STRUCTURAL_STRING_ARRAY_PROPERTY_NAMES.has(propName)) return true;
    }
  }

  // Skip metadata text fields commonly used in schema and UI definitions.
  if (ts.isStringLiteral(node) && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const propName = ts.isIdentifier(parent.name)
      ? parent.name.text
      : ts.isStringLiteral(parent.name)
      ? parent.name.text
      : "";
    if (STRUCTURAL_METADATA_PROPERTY_NAMES.has(propName)) return true;
  }

  // Skip enum member names
  if (ts.isEnumMember(parent) && parent.name === node) return true;

  // Skip enum member values (these are canonical definitions, not magic values)
  if (ts.isEnumMember(parent) && parent.initializer === node) return true;

  // Skip extracted constant declarations (UPPER_SNAKE_CASE = "value")
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    const varName = ts.isIdentifier(parent.name) ? parent.name.text : "";
    if (ALL_CAPS_REGEX.test(varName)) return true;
  }

  // Skip key lookups by literal: map["default"], obj["status"]
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;

  // Skip import paths and module specifiers
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isModuleDeclaration(parent)) return true;

  // Skip decorator arguments (framework metadata)
  if (ts.isDecorator(parent)) return true;

  // Skip JSX attribute values
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;

  // Skip template expression parts
  if (ts.isTemplateLiteralToken(node)) return true;

  // Skip type literal strings (e.g., literal type members in a union)
  if (ts.isLiteralTypeNode(parent)) return true;

  // Skip keys of type index signatures
  if (ts.isIndexedAccessTypeNode(parent)) return true;

  return false;
}

function collectLiterals(
  sourceFile: ts.SourceFile,
  counters: Map<string, ValueAccumulator>,
  checkNumbersFlag: boolean,
): void {
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node)) {
      processLiteral(node, sourceFile, counters);
    } else if (ts.isNumericLiteral(node) && checkNumbersFlag) {
      processLiteral(node, sourceFile, counters);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

function processLiteral(
  node: ts.StringLiteral | ts.NumericLiteral,
  sourceFile: ts.SourceFile,
  counters: Map<string, ValueAccumulator>,
): void {
  if (shouldSkip(node)) return;

  const rawText = node.getText(sourceFile);
  const kind: LiteralKind = ts.isStringLiteral(node) ? "string" : "number";
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // Whitelist checks
  if (kind === "string") {
    const val = node.text;

    // Skip whitelisted values
    if (STRING_WHITELIST.has(val)) return;

    // Skip short strings (< 4 characters)
    if (val.length < SHORT_STRING_MIN_LENGTH) return;

    // Skip ALL CAPS strings (constant names, env vars like "EXA_ROOT")
    if (ALL_CAPS_REGEX.test(val)) return;

    // Skip structural identifiers unlikely to benefit from constant extraction.
    if (isLikelyStructuralString(val)) return;

    // Test scaffolding identifiers are often intentionally duplicated.
    if (isTestFilePath(sourceFile.fileName) && /^(test|mock|fake|dummy)[-_]/i.test(val)) return;
  } else {
    const num = parseFloat(rawText);

    // Skip whitelisted numbers and non-numeric values
    if (NUMBER_WHITELIST.has(num) || isNaN(num)) return;

    // Skip numbers below threshold (100) — small values are usually indices,
    // counts, timeouts, or offsets that are intentionally inline.
    if (Math.abs(num) < MIN_NUMBER_THRESHOLD) return;

    // Skip common protocol/status/round values that are often conventional.
    if (isLikelyStructuralNumber(Math.abs(num))) return;
  }

  const key = `${kind}:${rawText}`;

  let acc = counters.get(key);
  if (!acc) {
    acc = { value: rawText, kind, occurrences: [], perFile: new Map() };
    counters.set(key, acc);
  }
  acc.occurrences.push({ file: sourceFile.fileName, line });
  acc.perFile.set(sourceFile.fileName, (acc.perFile.get(sourceFile.fileName) || 0) + 1);
}

function collectReusableLiteralKeys(
  sourceFile: ts.SourceFile,
  reusableLiteralKeys: Set<string>,
  checkNumbersFlag: boolean,
): void {
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node)) {
      if (!shouldSkip(node)) {
        reusableLiteralKeys.add(`string:${node.getText(sourceFile)}`);
      }
    } else if (ts.isNumericLiteral(node) && checkNumbersFlag) {
      if (!shouldSkip(node)) {
        reusableLiteralKeys.add(`number:${node.getText(sourceFile)}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

function calculateViolationScore(params: {
  scope: ViolationScope;
  totalOccurrences: number;
  distinctFiles: number;
  hasExistingConstantCandidate: boolean;
}): number {
  const scopeBonus = params.scope === "global" ? SCORE_SCOPE_GLOBAL_BONUS : SCORE_SCOPE_LOCAL_BONUS;
  const occurrenceScore = params.totalOccurrences * SCORE_PER_OCCURRENCE;
  const spreadScore = params.distinctFiles * SCORE_PER_DISTINCT_FILE;
  const constantBonus = params.hasExistingConstantCandidate ? SCORE_EXISTING_CONSTANT_BONUS : 0;

  return scopeBonus + occurrenceScore + spreadScore + constantBonus;
}

// ── Violation detection ──────────────────────────────────────────────────────

function detectViolations(
  counters: Map<string, ValueAccumulator>,
  reusableLiteralKeys: Set<string>,
): Violation[] {
  const violations: Violation[] = [];
  const reportedGlobal = new Set<string>();

  for (const [key, data] of counters) {
    const isString = data.kind === "string";
    const localThreshold = isString ? localStringThreshold : localNumberThreshold;
    const globalThreshold = isString ? globalStringThreshold : globalNumberThreshold;

    // Check global violations first
    if (data.occurrences.length > globalThreshold && !reportedGlobal.has(key)) {
      reportedGlobal.add(key);
      const hasExistingConstantCandidate = reusableLiteralKeys.has(key);
      const files: FileBreakdown[] = [];
      for (const [file, count] of data.perFile) {
        const firstLine = data.occurrences.find((o) => o.file === file)?.line ?? 0;
        files.push({ file, count, firstLine });
      }
      files.sort((a, b) => b.count - a.count);

      const score = calculateViolationScore({
        scope: "global",
        totalOccurrences: data.occurrences.length,
        distinctFiles: data.perFile.size,
        hasExistingConstantCandidate,
      });

      violations.push({
        value: data.value,
        kind: data.kind,
        scope: "global",
        totalOccurrences: data.occurrences.length,
        distinctFiles: data.perFile.size,
        score,
        hasExistingConstantCandidate,
        files,
      });
    }

    // Check local (per-file) violations
    for (const [file, count] of data.perFile) {
      if (count > localThreshold && data.occurrences.length <= globalThreshold) {
        const hasExistingConstantCandidate = reusableLiteralKeys.has(key);
        const fileOccurrences = data.occurrences.filter((o) => o.file === file);
        const firstLine = fileOccurrences[0]?.line ?? 0;

        const score = calculateViolationScore({
          scope: "local",
          totalOccurrences: count,
          distinctFiles: 1,
          hasExistingConstantCandidate,
        });

        violations.push({
          value: data.value,
          kind: data.kind,
          scope: "local",
          totalOccurrences: count,
          distinctFiles: 1,
          score,
          hasExistingConstantCandidate,
          files: [{ file, count, firstLine }],
        });
      }
    }
  }

  return violations;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Sort violations by:
 * 1. Candidate score (descending)
 * 2. Scope — GLOBAL before MODULE
 * 3. Distinct files affected (descending)
 * 4. Total occurrences (descending)
 */
function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    // GLOBAL scope first
    if (a.scope !== b.scope) {
      return a.scope === "global" ? -1 : 1;
    }
    // More files first
    if (a.distinctFiles !== b.distinctFiles) {
      return b.distinctFiles - a.distinctFiles;
    }
    // More occurrences first
    return b.totalOccurrences - a.totalOccurrences;
  });
}

// ── Reporting ────────────────────────────────────────────────────────────────

/** Maximum number of files to show per violation before summarising */
const MAX_FILES_TO_SHOW = 10;

function reportViolations(violations: Violation[]): void {
  for (const v of violations) {
    const scopeTag = v.scope === "global" ? "GLOBAL" : "MODULE";
    const filesLabel = v.distinctFiles === 1 ? "1 file" : `${v.distinctFiles} files`;
    const existingConstantTag = v.hasExistingConstantCandidate ? "yes" : "no";
    console.error(
      `[${scopeTag}] score=${v.score} existing-constant=${existingConstantTag} ${v.value} (${v.kind}) appears ${v.totalOccurrences}x across ${filesLabel}`,
    );
    console.error("    ┃");
    console.error("    ┃ per-file breakdown:");

    const shown = v.files.slice(0, MAX_FILES_TO_SHOW);
    for (const fb of shown) {
      const shortPath = relative(REPO_ROOT, fb.file);
      const label = fb.count === 1 ? "1 occurrence" : `${fb.count} occurrences`;
      console.error(`    ┃   ${shortPath}: ${label} (line ${fb.firstLine})`);
    }

    if (v.files.length > MAX_FILES_TO_SHOW) {
      const remaining = v.files.length - MAX_FILES_TO_SHOW;
      const remainingCount = v.files.slice(MAX_FILES_TO_SHOW).reduce((sum, fb) => sum + fb.count, 0);
      console.error(`    ┃   … and ${remaining} more file(s) with ${remainingCount} occurrence(s)`);
    }
    console.error("");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const counters = new Map<string, ValueAccumulator>();
  const reusableLiteralKeys = new Set<string>();

  const tsFiles: string[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [/^\.git$/, /^node_modules$/, /^dist$/, /^coverage$/, /check_magic_values\.ts$/],
    })
  ) {
    if (entry.path.includes("/.copilot/")) continue;
    if (entry.path.includes("/scripts/")) continue;
    if (!includeTests && isTestFilePath(entry.path)) continue;
    if (entry.path.includes("/tests/fixtures/")) continue;
    tsFiles.push(entry.path);
  }

  for (const filePath of tsFiles) {
    const source = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const isCanonicalDefinitionFile = isConstantOrEnumFilePath(filePath);

    if (isCanonicalDefinitionFile) {
      // Capture literals from canonical definition files for scoring/reuse hints,
      // but do not count them as violations in the defining module itself.
      collectReusableLiteralKeys(sourceFile, reusableLiteralKeys, checkNumbers);
      continue;
    }

    collectLiterals(sourceFile, counters, checkNumbers);
  }

  const violations = sortViolations(detectViolations(counters, reusableLiteralKeys));

  if (violations.length > 0) {
    console.error("❌ Magic value violations detected:\n");
    reportViolations(violations);
    console.error(`${violations.length} violation(s) found`);
    Deno.exit(1);
  }

  console.log("✅ No magic value violations detected");
}

if (import.meta.main) {
  main();
}
