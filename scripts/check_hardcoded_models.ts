#!/usr/bin/env -S deno run -A
/**
 * @module CheckHardcodedModels
 * @path scripts/check_hardcoded_models.ts
 * @description Scans non-test TS source and Blueprint .md files for hardcoded
 *   provider:model strings not in HARDCODED_MODEL_ALLOWLIST. Exits 0 if clean,
 *   1 if violations found.
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

import type { Opt, Reason } from "@exaix/core/types";
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

const SKIP_PATTERNS = [/\/static_overlay\.ts$/];

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

// Allowlist covers only mock/test identities — all business logic resolves models
// through IModelRegistry/IModelPricingLookup. The curated data file (static_overlay.ts)
// is exempted via SKIP_PATTERNS above. No new provider:model entries should be added.
const allowlist = new Set<string>([
  "mock:test",
  "mock:test-model",
]);

export function findModelViolations(
  content: string,
  filePath: string,
  allowlistArg?: Opt<Set<string>, Reason.TestOverride>,
): IViolation[] {
  const list = allowlistArg ?? allowlist;
  const violations: IViolation[] = [];
  const lines = content.split("\n");

  if (TEST_PATTERNS.some((p) => p.test(filePath))) return violations;
  if (SKIP_PATTERNS.some((p) => p.test(filePath))) return violations;

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

export async function checkAllFiles(
  allowlistArg?: Opt<Set<string>, Reason.TestOverride>,
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
      if (SKIP_PATTERNS.some((p) => p.test(fp))) continue;

      const content = await Deno.readTextFile(entry.path);
      scannedFiles.push(1);
      const violations = findModelViolations(content, fp, list);
      allViolations.push(...violations);
    }
  }

  // Scan Blueprints/ for .md files
  try {
    await Deno.stat("Blueprints");
    for await (const _entry of walk("Blueprints", { exts: [".md"], followSymlinks: false })) {
      const fp = relative(".", _entry.path);
      const content = await Deno.readTextFile(_entry.path);
      scannedFiles.push(1);
      const violations = findModelViolations(content, fp, list);
      allViolations.push(...violations);
    }
  } catch {
    // Blueprints/ doesn't exist
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
  try {
    await Deno.stat("Blueprints");
    for await (const _entry of walk("Blueprints", { exts: [".md"], followSymlinks: false })) {
      count++;
    }
  } catch {
    // Blueprints/ doesn't exist
  }
  return count;
}
