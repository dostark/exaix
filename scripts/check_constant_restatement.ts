#!/usr/bin/env -S deno run -A
/**
 * @module CheckConstantRestatement
 * @path scripts/check_constant_restatement.ts
 *
 * Usage:
 *   deno task check:constant-restatement                        # the registered form
 *   deno run --allow-read scripts/check_constant_restatement.ts # direct; exits 1 on findings
 *
 * @description Phase 142 Step 19 (GAP-3) — reports tests that hardcode a list constant's value
 *   instead of importing the constant and deriving it.
 *
 *   Step 7 extended `DAEMON_DEFAULT_NET_HOSTS` from two hosts to four. Four tests carried a
 *   hardcoded copy of the old list and broke. Nothing prevented that: every static gate was green
 *   while those tests asserted a behaviour the code no longer had, and the breakage surfaced far
 *   from the change. A test that restates a constant is a second source of truth for a value that
 *   already has one.
 *
 *   Scope is deliberately narrow — list-valued string constants in the core constants module,
 *   matched on two or more consecutive elements. A repo-wide literal comparison would be noisy
 *   against legitimate fixtures, and a noisy check gets turned off.
 *
 *   Manual invocation only (`deno task check:constant-restatement`). Per standing project
 *   instruction, new tasks are not attached to CI jobs or pre-commit gates.
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path]
 * @related-files [tests/scripts/check_constant_restatement_test.ts, packages/core/src/types/constants.ts]
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";

/** A test that writes out a constant's value rather than importing the constant. */
export interface IRestatement {
  /** Repo-relative path of the offending test. */
  file: string;
  /** Name of the constant whose value was restated. */
  constant: string;
  /** The restated run of elements, as it appears joined in the source. */
  value: string;
}

/** A source file to inspect. */
export interface ISourceFile {
  path: string;
  source: string;
}

/** Separators a list constant is realistically joined with in an assertion. A plain space is
 * deliberately absent — it would match ordinary English prose in unrelated fixtures. */
const JOIN_SEPARATORS: readonly string[] = [",", ", ", "|", ":"];

/** Characters marking an element as a structured token (hostname, path, prefix, extension)
 * rather than an English word — the kind of value a test copies verbatim. */
const STRUCTURED_TOKEN_CHARS = /[./:\-_=]/;

/** Shortest run of elements that counts as a restatement; one element is an ordinary
 * fixture value, two consecutive ones in declared order is a copy of the list. */
const MIN_RESTATED_ELEMENTS = 2;

const CONSTANTS_MODULE = join("packages", "core", "src", "types", "constants.ts");
const TEST_SUFFIX = "_test.ts";

/** Exported list-valued string constants, by name. Numeric lists are skipped since their
 * elements appear in unrelated code constantly and would produce noise. */
export function parseListConstants(source: string): Map<string, string[]> {
  const constants = new Map<string, string[]>();
  const declaration = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/g;

  for (const match of source.matchAll(declaration)) {
    const [, name, body] = match;
    // Strip comments so a commented-out entry cannot become an element.
    const withoutComments = body.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
    const elements = [...withoutComments.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
    // A list whose entries are not all plain string literals (numbers, identifiers, nested
    // objects) yields fewer matches than commas — treat only all-string lists as in scope.
    const commaCount = withoutComments.split(",").filter((part) => part.trim().length > 0).length;
    if (elements.length < MIN_RESTATED_ELEMENTS || elements.length !== commaCount) continue;
    // Prose lists are out of scope — see STRUCTURED_TOKEN_CHARS.
    if (!elements.every((element) => STRUCTURED_TOKEN_CHARS.test(element))) continue;
    constants.set(name, elements);
  }
  return constants;
}

/** Every run of `MIN_RESTATED_ELEMENTS`-or-more consecutive elements, joined each way. */
function restatableRuns(elements: string[]): string[] {
  const runs: string[] = [];
  for (let start = 0; start < elements.length; start++) {
    for (let end = start + MIN_RESTATED_ELEMENTS; end <= elements.length; end++) {
      const slice = elements.slice(start, end);
      for (const separator of JOIN_SEPARATORS) runs.push(slice.join(separator));
    }
  }
  // Longest first, so a finding reports the largest copy rather than a two-element fragment of it.
  return runs.sort((a, b) => b.length - a.length);
}

/** Tests that restate a constant's value without importing the constant. */
export function findRestatements(
  constants: Map<string, string[]>,
  files: ISourceFile[],
): IRestatement[] {
  const findings: IRestatement[] = [];

  for (const file of files) {
    for (const [name, elements] of constants) {
      // Importing the constant is the whole point: a test that derives the value cannot go stale.
      if (new RegExp(`\\b${name}\\b`).test(file.source)) continue;

      const hit = restatableRuns(elements).find((run) => file.source.includes(run));
      if (hit !== undefined) {
        findings.push({ file: file.path, constant: name, value: hit });
      }
    }
  }
  return findings;
}

/** Walk a repository checkout and report every restatement in its tests. */
export async function checkRepository(repoRoot: string): Promise<IRestatement[]> {
  const constants = parseListConstants(await Deno.readTextFile(join(repoRoot, CONSTANTS_MODULE)));

  const files: ISourceFile[] = [];
  for (const root of ["apps", "packages", "tests"]) {
    const rootPath = join(repoRoot, root);
    try {
      for await (const entry of walk(rootPath, { includeDirs: false, exts: [".ts"] })) {
        if (!entry.name.endsWith(TEST_SUFFIX)) continue;
        files.push({
          path: relative(repoRoot, entry.path),
          source: await Deno.readTextFile(entry.path),
        });
      }
    } catch {
      // A root need not exist in every checkout shape.
    }
  }

  return findRestatements(constants, files).sort((a, b) => a.file.localeCompare(b.file));
}

if (import.meta.main) {
  const findings = await checkRepository(Deno.cwd());
  if (findings.length === 0) {
    console.log("✅ No constant restatements found in tests.");
    Deno.exit(0);
  }
  console.error(`❌ ${findings.length} test(s) restate a constant instead of importing it:\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}`);
    console.error(`    restates ${finding.constant} as "${finding.value}"`);
    console.error(`    fix: import ${finding.constant} and derive the value from it\n`);
  }
  Deno.exit(1);
}
