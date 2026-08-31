#!/usr/bin/env -S deno run -A

/**
 * @module CheckStepManifests
 * @path scripts/check_step_manifests.ts
 * @description Validates that every step in a phase-NN-*.md planning document
 *   has a valid step-manifest (fenced YAML block with # step-manifest marker).
 *   Supports --since <number> to skip phase-NN files where NN < number.
 *   Exit code 0 = all steps valid; non-zero = failures found.
 * @architectural-layer Script
 * @dependencies [@exaix/schemas, @std/path, @std/yaml, @exaix/core]
 * @related-files [packages/schemas/src/step_manifest.ts, packages/core/src/types/constants.ts]
 *
 * Usage:
 *   deno run -A scripts/check_step_manifests.ts <path> [--since <phase-number>]
 *
 *   <path>             Path to a phase-NN-*.md file or directory of such files.
 *   --since <number>   Minimum phase number (e.g. 130); phase-NN files with NN < this are skipped.
 */

import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { StepManifestSchema } from "@exaix/schemas/step_manifest.ts";
import { MAX_PLAN_FILE_BYTES } from "@exaix/core/types";

/**
 * Result of a check run.
 */
export interface ICheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  checked: number;
  skipped: number;
}

export interface ICheckOptions {
  since?: number;
}

function parseArgs(): { path: string; since: number | null } {
  const args = Deno.args;
  if (args.length === 0) {
    console.error("Usage: check_step_manifests.ts <path> [--since <phase-number>]");
    Deno.exit(1);
  }
  const targetPath = args[0];
  let since: number | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--since" && i + 1 < args.length) {
      const val = parseInt(args[i + 1], 10);
      if (!isNaN(val)) since = val;
      i++;
    }
  }
  return { path: targetPath, since };
}

function isPhasePlanFile(name: string): boolean {
  return /^phase-\d+-.+\.md$/.test(name);
}

function phaseNumberFromPath(filePath: string): number | null {
  const name = filePath.split("/").pop() ?? "";
  const match = name.match(/^phase-(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

function shouldSkipByPhase(filePath: string, since: number | null): boolean {
  if (!since) return false;
  const phase = phaseNumberFromPath(filePath);
  return phase !== null && phase < since;
}

interface ManifestAcceptance {
  tests?: string[];
  outcomes?: string[];
}

interface ManifestRecord {
  step?: number;
  title?: string;
  identity?: string;
  skills?: string[];
  portal?: string;
  target_branch?: string;
  depends_on?: number[];
  acceptance?: ManifestAcceptance;
  [key: string]: string | number | boolean | string[] | number[] | ManifestAcceptance | undefined;
}

interface ParsedStep {
  number: number;
  sectionText: string;
}

function parseSteps(content: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  const stepRegex = /^#{2,3}\s+Step\s+(\d+)\s*[:：]?\s*(.*)$/gm;
  let lastIndex = 0;
  let lastStepNumber = 0;

  const matches: { match: RegExpExecArray; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = stepRegex.exec(content)) !== null) {
    matches.push({ match: m, index: m.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const { match, index } = matches[i];
    const stepNumber = parseInt(match[1], 10);
    if (lastIndex > 0) {
      steps.push({ number: lastStepNumber, sectionText: content.slice(lastIndex, index).trim() });
    }
    lastIndex = index;
    lastStepNumber = stepNumber;
  }

  if (lastIndex > 0) {
    steps.push({ number: lastStepNumber, sectionText: content.slice(lastIndex).trim() });
  }

  return steps;
}

function extractManifest(sectionText: string): ManifestRecord | null {
  // Scan ALL yaml fences in the section and select the one carrying the
  // `# step-manifest` marker, so an illustrative yaml fence appearing before the
  // real manifest does not shadow it.
  const fenceRegex = /```yaml\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(sectionText)) !== null) {
    const yamlBlock = m[1];
    if (!yamlBlock.includes("# step-manifest")) continue;

    try {
      const parsed = parseYaml(yamlBlock);
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed as ManifestRecord;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Check a single plan file for valid step manifests.
 */
export async function checkStepManifests(
  filePath: string,
  options: ICheckOptions = {},
): Promise<ICheckResult> {
  const result: ICheckResult = { success: true, errors: [], warnings: [], checked: 0, skipped: 0 };

  // Check file size
  const stat = await Deno.stat(filePath);
  if (stat.size > MAX_PLAN_FILE_BYTES) {
    result.success = false;
    result.errors.push(
      `File exceeds MAX_PLAN_FILE_BYTES (${stat.size} > ${MAX_PLAN_FILE_BYTES}): ${filePath}`,
    );
    return result;
  }

  // Check --since skip
  if (shouldSkipByPhase(filePath, options.since ?? null)) {
    result.skipped = 1;
    return result;
  }

  const content = await Deno.readTextFile(filePath);
  const steps = parseSteps(content);

  if (steps.length === 0) {
    result.warnings.push(`No step headings found in: ${filePath}`);
    return result;
  }

  for (const step of steps) {
    const manifest = extractManifest(step.sectionText);
    if (!manifest) {
      result.success = false;
      result.errors.push(`Step ${step.number}: missing or unparseable step-manifest`);
      continue;
    }

    const parsed = StepManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      result.success = false;
      result.errors.push(
        `Step ${step.number}: invalid step-manifest — ${parsed.error.message}`,
      );
    }
  }

  result.checked = steps.length;
  return result;
}

async function walkDir(dir: string, since: number | null): Promise<ICheckResult> {
  const combined: ICheckResult = { success: true, errors: [], warnings: [], checked: 0, skipped: 0 };

  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !isPhasePlanFile(entry.name)) continue;
    const filePath = join(dir, entry.name);
    const fileResult = await checkStepManifests(filePath, { since: since ?? undefined });
    combined.errors.push(...fileResult.errors);
    combined.warnings.push(...fileResult.warnings);
    combined.checked += fileResult.checked;
    combined.skipped += fileResult.skipped;
    if (!fileResult.success) combined.success = false;
  }

  return combined;
}

async function main() {
  const { path: targetPath, since } = parseArgs();
  const resolvedPath = resolve(targetPath);

  let result: ICheckResult;
  try {
    const stat = await Deno.stat(resolvedPath);
    if (stat.isDirectory) {
      result = await walkDir(resolvedPath, since);
    } else {
      result = await checkStepManifests(resolvedPath, { since: since ?? undefined });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    Deno.exit(1);
  }

  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`ERROR: ${e}`);

  if (result.checked > 0 || result.skipped > 0) {
    const sinceInfo = since ? ` (--since ${since})` : "";
    console.log(
      `Checked ${result.checked} step(s) across processed files; ${result.skipped} file(s) skipped${sinceInfo}.`,
    );
  }

  if (!result.success) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
