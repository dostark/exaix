/**
 * @module PatternDetector
 * @path packages/portal/src/knowledge/pattern_detector.ts
 * @description Strategy 4 of PortalKnowledgeService: detects code conventions
 * and naming patterns from file structure and optionally from file contents.
 * Heuristic-only mode requires no I/O; content-based mode reads a sample of
 * key files to detect import styles and DI patterns.
 * Pure function module — zero LLM dependencies, sandboxed-safe.
 * @architectural-layer Services
 * @related-files [packages/portal/src/knowledge/key_file_identifier.ts, packages/portal/src/knowledge/config_parser.ts]
 */

import { basename, extname } from "@std/path";
import type { ICodeConvention, IFileSignificance } from "@exaix/schemas";

const MAX_EXAMPLES = 5;

const BARREL_NAMES = new Set(["mod.ts", "index.ts", "mod.js", "index.js"]);

const TEST_NAMING_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /_test\.(ts|tsx|js|jsx|py|go|rb)$/, label: "_test" },
  { pattern: /\.test\.(ts|tsx|js|jsx)$/, label: ".test" },
  { pattern: /\.spec\.(ts|tsx|js|jsx)$/, label: ".spec" },
];

const NAMING_KEYWORDS: ReadonlyArray<
  { readonly keyword: string; readonly name: string; readonly description: string }
> = [
  {
    keyword: "service",
    name: "Service naming pattern",
    description: "Source files follow a *service* naming convention",
  },
  {
    keyword: "repository",
    name: "Repository naming pattern",
    description: "Source files follow a *repository* naming convention",
  },
  {
    keyword: "controller",
    name: "Controller naming pattern",
    description: "Source files follow a *controller* naming convention",
  },
  {
    keyword: "handler",
    name: "Handler naming pattern",
    description: "Source files follow a *handler* naming convention",
  },
];

/**
 * Detects code conventions and naming patterns from file structure.
 * Heuristic-only mode: no I/O, synchronous.
 */
export function detectPatterns(
  portalPath: string,
  fileList: string[],
  keyFiles: IFileSignificance[],
): ICodeConvention[];

/**
 * Detects code conventions and naming patterns from file structure and content.
 * Content-based mode: reads a sample of files via `readFileContents` callback.
 */
export function detectPatterns(
  portalPath: string,
  fileList: string[],
  keyFiles: IFileSignificance[],
  readFileContents: (path: string) => Promise<string>,
): Promise<ICodeConvention[]>;

export function detectPatterns(
  _portalPath: string,
  fileList: string[],
  _keyFiles: IFileSignificance[],
  readFileContents?: (path: string) => Promise<string>,
): ICodeConvention[] | Promise<ICodeConvention[]> {
  const conventions = runHeuristicPass(fileList);
  if (!readFileContents) return conventions;
  return runContentPass(fileList, conventions, readFileContents);
}

function runHeuristicPass(fileList: string[]): ICodeConvention[] {
  const conventions: ICodeConvention[] = [];

  for (const { keyword, name, description } of NAMING_KEYWORDS) {
    const c = detectNamingKeyword(fileList, keyword, name, description);
    if (c) conventions.push(c);
  }

  const coLocated = detectCoLocatedTests(fileList);
  if (coLocated) conventions.push(coLocated);

  const mirror = detectMirrorTestLayout(fileList);
  if (mirror) conventions.push(mirror);

  const testNaming = detectTestNamingConvention(fileList);
  if (testNaming) conventions.push(testNaming);

  const barrels = detectBarrelExports(fileList);
  if (barrels) conventions.push(barrels);

  return conventions;
}

async function runContentPass(
  fileList: string[],
  baseConventions: ICodeConvention[],
  readFileContents: (path: string) => Promise<string>,
): Promise<ICodeConvention[]> {
  const aliasExamples: string[] = [];

  for (const file of fileList) {
    const content = await readFileContents(file);
    if (/import .+ from ["']@\w/.test(content)) {
      aliasExamples.push(file);
    }
  }

  const conventions = [...baseConventions];

  if (aliasExamples.length > 0) {
    conventions.push(
      buildConvention(
        "Alias import patterns",
        "Source files use path alias imports (e.g., @shared/, @config/) instead of relative paths",
        "imports",
        aliasExamples,
      ),
    );
  }

  return conventions;
}

function detectNamingKeyword(
  fileList: string[],
  keyword: string,
  name: string,
  description: string,
): ICodeConvention | null {
  const matches = fileList.filter((f) => basename(f, extname(f)).toLowerCase().includes(keyword));
  if (matches.length === 0) return null;
  return buildConvention(name, description, "naming", matches);
}

function detectCoLocatedTests(fileList: string[]): ICodeConvention | null {
  const matches = fileList.filter((f) => f.includes("/__tests__/") || f.includes("\\__tests__\\"));
  if (matches.length === 0) return null;
  return buildConvention(
    "Co-located test layout",
    "Tests are co-located alongside source files in __tests__ directories",
    "structure",
    matches,
  );
}

function detectMirrorTestLayout(fileList: string[]): ICodeConvention | null {
  const testFiles = fileList.filter(
    (f) => f.startsWith("tests/") || /\/tests\//.test(f),
  );
  const srcFiles = fileList.filter(
    (f) => f.startsWith("src/") || /\/src\//.test(f),
  );
  if (testFiles.length === 0 || srcFiles.length === 0) return null;

  const mirrorMatches = testFiles.filter((tf) => {
    const testBase = basename(tf, extname(tf)).replace(/_test$|\.test$|\.spec$/, "");
    return srcFiles.some((sf) => basename(sf, extname(sf)) === testBase);
  });

  if (mirrorMatches.length === 0) return null;
  return buildConvention(
    "Mirror test layout",
    "Tests mirror the src/ structure in a separate tests/ root directory",
    "structure",
    mirrorMatches,
  );
}

function detectTestNamingConvention(fileList: string[]): ICodeConvention | null {
  let best: { label: string; matches: string[] } | null = null;

  for (const { pattern, label } of TEST_NAMING_PATTERNS) {
    const matches = fileList.filter((f) => pattern.test(f));
    if (matches.length > 0 && (!best || matches.length > best.matches.length)) {
      best = { label, matches };
    }
  }

  if (!best) return null;
  return buildConvention(
    `${best.label} test naming convention`,
    `Test files follow the ${best.label} naming convention`,
    "testing",
    best.matches,
  );
}

function detectBarrelExports(fileList: string[]): ICodeConvention | null {
  const matches = fileList.filter((f) => BARREL_NAMES.has(basename(f)));
  if (matches.length === 0) return null;
  const primaryName = matches.some((f) => basename(f) === "mod.ts") ? "mod.ts" : "index.ts";
  return buildConvention(
    `Barrel export pattern (${primaryName})`,
    `Modules use ${primaryName} barrel files to re-export public API`,
    "structure",
    matches,
  );
}

function buildConvention(
  name: string,
  description: string,
  category: ICodeConvention["category"],
  matches: string[],
): ICodeConvention {
  return {
    name,
    description,
    examples: matches.slice(0, MAX_EXAMPLES),
    category,
    evidenceCount: matches.length,
    confidence: calcConfidence(matches.length),
  };
}

function calcConfidence(count: number): ICodeConvention["confidence"] {
  if (count >= 10) return "high";
  if (count >= 3) return "medium";
  return "low";
}
