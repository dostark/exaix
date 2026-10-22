#!/usr/bin/env -S deno run -A
/**
 * @module CheckMagicValues
 * @path packages/lint-policy/src/checkers/check_magic_values.ts
 * @description Magic Value Detector — scans TypeScript sources using the compiler API
 * AST to find repeated string/number literals that should be extracted
 * into named constants or enums.
 * @architectural-layer Tooling
 * @dependencies [@std/fs, @std/path, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run -A packages/lint-policy/src/checkers/check_magic_values.ts          # strings + numbers
 *   deno run -A packages/lint-policy/src/checkers/check_magic_values.ts --no-numbers  # strings only
 *   deno run -A packages/lint-policy/src/checkers/check_magic_values.ts --include-tests  # include tests
 *
 * The repository root comes from `--root=` or the working directory. Run it from the
 * repository root, as the `check:magic` task does.
 *
 * Thresholds (per-module / global):
 *   strings:  occurrences > 3  (local)  / > 5  (global)
 *   numbers:  occurrences > 4  (local)  / > 6  (global)
 */

import { walk } from "@std/fs";
import { globToRegExp, relative } from "@std/path";
import { classifyPath, type PathClass } from "@dostark/unslop-ts";
import {
  detectMagicLiterals,
  DuplicateConstantOptionsSchema,
  findDuplicateConstants,
  formatMagicViolation,
  type IMagicLiteralFile,
  MagicLiteralOptionsSchema,
  validateConstantAllowEntries,
} from "@dostark/unslop-ts/whole-tree";
import { LAYOUT } from "../repo_layout.ts";
import { POLICY_CATALOG } from "../policy_config.ts";

// SAFETY: the catalog loader validates the scopes section against its schema.
const CATALOG_SCOPES = POLICY_CATALOG.scopes;

// CLI flags

const args = new Set(Deno.args);
const numbersDisabledByFlag = args.has("--no-numbers") || args.has("--strings-only");
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
  deno run -A ${LAYOUT.packageRoot}lint-policy/${LAYOUT.srcRoot}checkers/check_magic_values.ts [options]

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

/** Classifies a repository-relative path with the shared catalog scopes. */
export function classifyRepoPath(filePath: string): PathClass {
  return classifyPath(filePath, CATALOG_SCOPES);
}

function isTestFilePath(filePath: string): boolean {
  return classifyRepoPath(filePath) === "test";
}

/** Resolves the repository root from `--root=` or the working directory. */
function resolveRepoRoot(): string {
  const rootArg = Deno.args.find((arg) => arg.startsWith("--root="));
  return rootArg ? rootArg.slice("--root=".length) : Deno.cwd();
}

const REPO_ROOT = resolveRepoRoot();

/** The detector options: the catalog section, with the command-line thresholds and flags on top. */
function detectorOptions() {
  const configured = MagicLiteralOptionsSchema.parse(POLICY_CATALOG.wholeTree?.magicLiterals);
  const thresholds = configured.thresholds;
  return {
    ...configured,
    checkNumbers: configured.checkNumbers && !numbersDisabledByFlag,
    thresholds: {
      localString: getNumericFlagValue("--local-string-threshold") ?? thresholds.localString,
      globalString: getNumericFlagValue("--global-string-threshold") ?? thresholds.globalString,
      localNumber: getNumericFlagValue("--local-number-threshold") ?? thresholds.localNumber,
      globalNumber: getNumericFlagValue("--global-number-threshold") ?? thresholds.globalNumber,
    },
  };
}

// Main

const DUPLICATE_UNITS: Array<{ path: string; text: string }> = [];

/** Whole-tree duplicate-constant pass, run after the per-file checks. */
function runDuplicateConstantPass(): number {
  const options = DuplicateConstantOptionsSchema.parse(POLICY_CATALOG.rules["duplicate-constant"]?.options ?? {});
  // SAFETY: the catalog loader validates the duplicate-constant include list against its schema.
  const include = (POLICY_CATALOG.rules["duplicate-constant"]?.include ?? []) as string[];
  const units = DUPLICATE_UNITS.filter((unit) =>
    unit.path.startsWith(LAYOUT.packageRoot) || unit.path.startsWith(LAYOUT.appRoot)
  )
    .filter((unit) =>
      include.length === 0 ||
      include.some((glob) => globToRegExp(glob, { extended: true, globstar: true }).test(unit.path))
    );
  let count = 0;
  for (const duplicate of findDuplicateConstants(units, options)) {
    console.log(
      `ERROR [duplicate-constant] ${duplicate.laterFile} – '${duplicate.name}' duplicates ${duplicate.firstFile}. Keep one owner and import it.`,
    );
    count++;
  }
  for (const name of validateConstantAllowEntries(units, options)) {
    console.log(`ERROR [duplicate-constant] the allow entry '${name}' matches no current duplicate.`);
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const files: IMagicLiteralFile[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [
        /[/\\]\.git[/\\]/,
        /[/\\]node_modules[/\\]/,
        /[/\\]dist[/\\]/,
        /[/\\]coverage[/\\]/,
        // Self-tooling skip: the checkers' own literals are rule regexes and messages,
        // not extractable magic values (mirrors check_code_style's catalog self-exemption).
        /check_magic_values\.ts$/,
        /check_code_style\.ts$/,
        /repo_layout\.ts$/,
        /lint-policy[/\\]plugin\.ts$/,
        /[/\\]whole_tree[/\\]/,
        /[/\\]unslop-ts[/\\]/,
      ],
    })
  ) {
    if (entry.path.includes(LAYOUT.copilotSegment)) continue;
    if (entry.path.includes(LAYOUT.scriptsSegment)) continue;
    const isTest = isTestFilePath(entry.path);
    if (!includeTests && isTest) continue;
    if (entry.path.includes(LAYOUT.fixturesSegment)) continue;
    const text = await Deno.readTextFile(entry.path);
    files.push({ path: entry.path, text, isTest });
    DUPLICATE_UNITS.push({ path: relative(REPO_ROOT, entry.path), text });
  }

  const violations = detectMagicLiterals(files, detectorOptions());
  const duplicateCount = runDuplicateConstantPass();

  if (violations.length > 0) {
    console.error("❌ Magic value violations detected:\n");
    for (const violation of violations) {
      for (const line of formatMagicViolation(violation, (path) => relative(REPO_ROOT, path))) console.error(line);
    }
    console.error(`${violations.length} violation(s) found`);
    Deno.exit(1);
  }

  console.log("✅ No magic value violations detected");
  if (duplicateCount > 0) Deno.exit(1);
}

if (import.meta.main) {
  main();
}
