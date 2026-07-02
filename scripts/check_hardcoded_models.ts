#!/usr/bin/env -S deno run -A
/**
 * @module CheckHardcodedModels
 * @path scripts/check_hardcoded_models.ts
 * @description Scans non-test TS source for hardcoded provider:model strings not
 *   in the HARDCODED_MODEL_ALLOWLIST. Exits 0 if clean, 1 if violations found.
 * @related-files [packages/core/src/types/constants.ts, tests/scripts/check_hardcoded_models_test.ts]
 * @dependencies [@std/fs, @exaix/core]
 *
 * Usage:
 *   deno run -A scripts/check_hardcoded_models.ts
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more violations found
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";
import { HARDCODED_MODEL_ALLOWLIST } from "@exaix/core";

export interface IViolation {
  file: string;
  line: number;
  col: number;
  model: string;
  text: string;
}

const MODEL_PATTERN = /"([a-z][a-z0-9_]*:[a-z][-a-z0-9._/]+)"/gi;
const COMMENT_PATTERN = /^\s*\/\//;
const TEST_PATTERNS = [/_test\.ts$/, /\/tests\//, /\/testing\//, /^tests\//];

const KNOWN_PROVIDER_PREFIXES = new Set([
  "anthropic",
  "openai",
  "google",
  "ollama",
  "llamacpp",
  "openrouter",
  "vertex",
  "mock",
]);

const allowlist = new Set<string>(HARDCODED_MODEL_ALLOWLIST);

/**
 * Scan a single file's content for hardcoded provider:model strings not in the
 * allowlist. Returns violations with file, line, col, model string, and context.
 * Test files and comment lines are automatically skipped.
 */
export function findModelViolations(
  content: string,
  filePath: string,
  allowlistArg?: Set<string>,
): IViolation[] {
  const list = allowlistArg ?? allowlist;
  const violations: IViolation[] = [];
  const lines = content.split("\n");

  if (TEST_PATTERNS.some((p) => p.test(filePath))) return violations;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (COMMENT_PATTERN.test(raw)) continue;

    let match: RegExpExecArray | null;
    MODEL_PATTERN.lastIndex = 0;

    while ((match = MODEL_PATTERN.exec(raw)) !== null) {
      const model = match[1].toLowerCase();

      if (!KNOWN_PROVIDER_PREFIXES.has(model.split(":")[0])) continue;

      if (!list.has(model)) {
        violations.push({
          file: filePath,
          line: i + 1,
          col: match.index + 1,
          model,
          text: raw.trim().slice(0, 120),
        });
      }
    }
  }

  return violations;
}

/**
 * Walk packages/, apps/, and packages-team/ directories and scan every non-test
 * TS file for hardcoded model violations.
 */
export async function checkAllFiles(
  allowlistArg?: Set<string>,
): Promise<IViolation[]> {
  const list = allowlistArg ?? allowlist;
  const allViolations: IViolation[] = [];
  const scannedFiles: number[] = [];

  for (const dir of ["packages", "packages-team", "apps"]) {
    let dirExists = true;
    try {
      await Deno.stat(dir);
    } catch {
      dirExists = false;
    }
    if (!dirExists) continue;

    for await (const entry of walk(dir, { exts: [".ts"], followSymlinks: false })) {
      const fp = relative(".", entry.path);

      if (TEST_PATTERNS.some((p) => p.test(fp))) continue;

      const content = await Deno.readTextFile(entry.path);
      scannedFiles.push(1);
      const violations = findModelViolations(content, fp, list);
      allViolations.push(...violations);
    }
  }

  return allViolations;
}

// CLI entry point
if (import.meta.main) {
  const violations = await checkAllFiles();

  if (violations.length === 0) {
    console.log(`✅ No hardcoded model violations found (${await countFiles()} files scanned).`);
    Deno.exit(0);
  }

  console.error(`\n❌ Found ${violations.length} hardcoded model string(s) outside allowlist:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}  "${v.model}"`);
    console.error(`    ${v.text}`);
    console.error();
  }
  console.error("Add the model to HARDCODED_MODEL_ALLOWLIST in packages/core/src/types/constants.ts");
  console.error("or replace with a config reference / ModelResolver call.");
  Deno.exit(1);
}

async function countFiles(): Promise<number> {
  let count = 0;
  for (const dir of ["packages", "packages-team", "apps"]) {
    try {
      await Deno.stat(dir);
      for await (const entry of walk(dir, { exts: [".ts"], followSymlinks: false })) {
        if (!TEST_PATTERNS.some((p) => p.test(relative(".", entry.path)))) count++;
      }
    } catch {
      // dir doesn't exist
    }
  }
  return count;
}
