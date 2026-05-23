#!/usr/bin/env -S deno run -A
/**
 * @module CheckTestPlacement
 * @path scripts/check_test_placement.ts
 * @description Enforces repository test-file placement conventions for Exaix.
 *
 * Rules:
 * - Test files matching `*_test.ts(x)` must live under `tests/`,
 *   `packages/<name>/tests/`, or `apps/<name>/tests/`.
 * - Tests for packages must live under `packages/<name>/tests/`, not
 *   directly under `tests/`.
 *
 * Usage:
 *   deno run -A scripts/check_test_placement.ts          # inspect staged files
 *   deno run -A scripts/check_test_placement.ts --ci     # inspect HEAD~1 diff
 *   deno run -A scripts/check_test_placement.ts --all    # inspect whole repo
 */

import { relative, resolve } from "@std/path";
import { walk } from "@std/fs";

export interface ITestPlacementIssue {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ITestPlacementResult {
  success: boolean;
  issues: ITestPlacementIssue[];
  inspectedPaths: string[];
}

const REPO_ROOT = resolve(new URL("../", import.meta.url).pathname);
const TEST_FILE_PATTERN = /(^|\/)[^/]+_test\.(ts|tsx|js|jsx)$/;
const ROOT_TESTS_PREFIX = "tests/";
const PACKAGE_TEST_PATTERN = /^packages\/[^/]+(?:\/[^/]+)?\/tests\//;
const APP_TEST_PATTERN = /^apps\/[^/]+\/tests\//;
const DIRECT_SERVICE_TEST_PATTERN = /^tests\/services\/[^/]+_test\.(ts|tsx|js|jsx)$/;

const SKIP_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)dist(\/|$)/,
];

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isTestFilePath(path: string): boolean {
  return TEST_FILE_PATTERN.test(normalizePath(path));
}

export function recommendTestDirectoryForSource(path: string): string | null {
  const normalized = normalizePath(path);

  if (normalized.startsWith("packages/")) {
    const parts = normalized.split("/");
    if (parts.length >= 3 && parts[2] === "src") {
      return `packages/${parts[1]}/tests/`;
    }
  }

  if (normalized.startsWith("scripts/")) {
    return "tests/scripts/";
  }

  if (normalized.startsWith("apps/")) {
    const parts = normalized.split("/");
    if (parts.length >= 2) {
      return `apps/${parts[1]}/tests/`;
    }
  }

  return null;
}

export function getTestPlacementIssue(path: string): ITestPlacementIssue | null {
  const normalized = normalizePath(path);
  if (!isTestFilePath(normalized)) {
    return null;
  }

  if (
    !normalized.startsWith(ROOT_TESTS_PREFIX) && !PACKAGE_TEST_PATTERN.test(normalized) &&
    !APP_TEST_PATTERN.test(normalized)
  ) {
    return {
      path: normalized,
      message: "Test files must live under tests/, packages/<package>/tests/, or apps/<app>/tests/.",
      suggestion: recommendTestDirectoryForSource(normalized) ??
        "Move this file under tests/ or a package/app tests folder.",
    };
  }

  if (normalized.startsWith(ROOT_TESTS_PREFIX) && DIRECT_SERVICE_TEST_PATTERN.test(normalized)) {
    return {
      path: normalized,
      message: "Service tests must live under tests/services/<domain>/, not directly under tests/services/.",
      suggestion: "Move this file into the appropriate domain folder under tests/services/.",
    };
  }

  return null;
}

export function validateTestPlacement(paths: string[]): ITestPlacementResult {
  const inspectedPaths = paths
    .map(normalizePath)
    .filter((path) => isTestFilePath(path));
  const issues = inspectedPaths
    .map((path) => getTestPlacementIssue(path))
    .filter((issue): issue is ITestPlacementIssue => issue !== null);

  return {
    success: issues.length === 0,
    issues,
    inspectedPaths,
  };
}

async function runGit(...args: string[]): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout).trim();
}

export async function getStagedFiles(): Promise<string[]> {
  const output = await runGit("diff", "--cached", "--name-only", "--diff-filter=ACMR");
  return output.split("\n").map(normalizePath).filter(Boolean);
}

export async function getCiFiles(): Promise<string[]> {
  const output = await runGit("diff", "HEAD~1", "HEAD", "--name-only", "--diff-filter=ACMR");
  return output.split("\n").map(normalizePath).filter(Boolean);
}

export async function getAllRepoFiles(root: string = REPO_ROOT): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of walk(root, { includeDirs: false })) {
    const relativePath = normalizePath(relative(root, entry.path));
    if (SKIP_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      continue;
    }

    if (isTestFilePath(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function main(): Promise<void> {
  const useCiDiff = Deno.args.includes("--ci");
  const useAllFiles = Deno.args.includes("--all");

  const providedPaths = Deno.args
    .filter((arg) => !arg.startsWith("--"))
    .map(normalizePath)
    .filter(Boolean);

  const paths = providedPaths.length > 0
    ? providedPaths
    : useAllFiles
    ? await getAllRepoFiles()
    : useCiDiff
    ? await getCiFiles()
    : await getStagedFiles();

  const result = validateTestPlacement(paths);

  if (result.inspectedPaths.length === 0) {
    console.log("✅ No test-placement candidates found.");
    return;
  }

  if (result.success) {
    console.log(`✅ Test placement valid (${result.inspectedPaths.length} test file(s) checked).`);
    return;
  }

  console.error("❌ Invalid test placement detected:\n");
  for (const issue of result.issues) {
    console.error(`- ${issue.path}`);
    console.error(`  ${issue.message}`);
    if (issue.suggestion) {
      console.error(`  Suggested location: ${issue.suggestion}`);
    }
  }

  Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
