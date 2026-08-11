#!/usr/bin/env -S deno run -A
/**
 * @module CheckRuntimeArtifacts
 * @path scripts/check_runtime_artifacts.ts
 * @description Pre-commit gate blocking obviously-generated runtime/dependency-manager
 *   artifacts (Python virtualenvs, `__pycache__`, `node_modules`, OS metadata files, compiled
 *   bytecode, tool caches) from being staged into a commit — either as literal files under a
 *   runtime-artifact directory, or embedded inside a staged `.patch`/`.diff` file's
 *   `diff --git a/<path> b/<path>` header lines. The latter is the real incident this gate
 *   guards against: Phase 144's Terminal-Bench ingest once captured an oracle solution's
 *   ENTIRE Python venv (4300 files, 37.8MB, compiled `.pyc`, `sympy`/`mpmath`, `venv/bin/
 *   python` binaries) inside a vendored `reference.patch`, because nothing checked the diff's
 *   own content for runtime-artifact paths before it was committed.
 *
 * Usage:
 *   deno run -A scripts/check_runtime_artifacts.ts
 * @architectural-layer Tooling
 * @related-files [scripts/setup_hooks.ts, scripts/check_optional_params.ts]
 */

import { join } from "@std/path";

/** One reported violation: a runtime-artifact path found either as a staged file itself, or
 *  embedded in a staged patch/diff file's content. */
export interface IRuntimeArtifactViolation {
  /** The staged file that carries the violation. */
  stagedPath: string;
  /** The offending runtime-artifact path (may equal `stagedPath` itself, or be a path found
   *  inside `stagedPath`'s diff content). */
  artifactPath: string;
  /** Whether the artifact IS the staged file, or was found embedded inside its diff content. */
  kind: "staged-file" | "embedded-in-diff";
}

const REPO_ROOT = join(import.meta.dirname!, "..");

/** Path segments that are unambiguously generated/runtime, never hand-authored source.
 *  Matched as a WHOLE path segment (split on "/"), not a substring — "venv" must not match
 *  "myvenv" or "prevented". Extend deliberately; a false-positive here blocks real commits. */
export const RUNTIME_ARTIFACT_DIR_SEGMENTS: Record<string, true> = {
  "venv": true,
  ".venv": true,
  "virtualenv": true,
  "__pycache__": true,
  "node_modules": true,
  ".pytest_cache": true,
  ".mypy_cache": true,
  ".ruff_cache": true,
  ".tox": true,
  "site-packages": true,
};

/** Exact basenames that are always OS/tool-generated cruft, regardless of directory. */
export const RUNTIME_ARTIFACT_FILENAMES: Record<string, true> = {
  ".DS_Store": true,
  "Thumbs.db": true,
  "desktop.ini": true,
};

/** File extensions that are always compiled/cached output, never source — a suffix check,
 *  not an exact-membership lookup, so this stays an array (iterated with `.some`). */
export const RUNTIME_ARTIFACT_EXTENSIONS: readonly string[] = [".pyc", ".pyo"];

/** True if `path` (repo-root-relative, `/`-separated) is itself a runtime artifact. */
export function isRuntimeArtifactPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => RUNTIME_ARTIFACT_DIR_SEGMENTS[segment])) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? path;
  if (RUNTIME_ARTIFACT_FILENAMES[basename]) {
    return true;
  }
  return RUNTIME_ARTIFACT_EXTENSIONS.some((ext) => basename.endsWith(ext));
}

/** Matches a unified-diff file header line and captures its "b/" (new) side path — the same
 *  shape `git diff`/`git apply` produce, which is exactly what a vendored `reference.patch`
 *  contains. Deliberately ignores the "a/" side: a rename OUT of a runtime-artifact dir is not
 *  itself a violation, only content that lands (or already sits) inside one. */
const DIFF_GIT_HEADER = /^diff --git a\/.+? b\/(.+)$/gm;

/** Scans `content` (assumed to be unified-diff / `.patch` text) for embedded `diff --git`
 *  headers whose target path is a runtime artifact. Returns the offending paths, deduped. */
export function findEmbeddedRuntimeArtifactPaths(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(DIFF_GIT_HEADER)) {
    const path = match[1]?.trim();
    if (path && isRuntimeArtifactPath(path)) {
      found.add(path);
    }
  }
  return [...found];
}

/** True if `path` looks like a unified-diff/patch file worth scanning for embedded headers —
 *  by extension, or by content sniffing (a vendored patch need not use a `.patch` extension). */
function looksLikePatchFile(path: string, content: string): boolean {
  if (path.endsWith(".patch") || path.endsWith(".diff")) return true;
  return content.startsWith("diff --git ") || content.includes("\ndiff --git ");
}

/** Pure core: classify each `{path, content}` staged entry against the runtime-artifact
 *  rules. `content` is optional — omit it (or pass `undefined`) for binary files, which are
 *  still checked by path but never scanned for embedded diff headers. */
export function findRuntimeArtifactViolations(
  entries: readonly { path: string; content?: string }[],
): IRuntimeArtifactViolation[] {
  const violations: IRuntimeArtifactViolation[] = [];
  for (const { path, content } of entries) {
    if (isRuntimeArtifactPath(path)) {
      violations.push({ stagedPath: path, artifactPath: path, kind: "staged-file" });
      continue;
    }
    if (content !== undefined && looksLikePatchFile(path, content)) {
      for (const artifactPath of findEmbeddedRuntimeArtifactPaths(content)) {
        violations.push({ stagedPath: path, artifactPath, kind: "embedded-in-diff" });
      }
    }
  }
  return violations;
}

/** Repo-root-relative paths of staged (added/copied/modified/renamed) files. */
async function stagedFiles(): Promise<string[]> {
  const out = await new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    cwd: REPO_ROOT,
    // See scripts/check_edition_graph.ts for why LD_LIBRARY_PATH is scrubbed here.
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return [];
  return new TextDecoder().decode(out.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Reads a staged file's TEXT content for patch-header scanning; `undefined` for binary
 *  files or anything unreadable (path-only checks still apply to those). */
async function readStagedTextContent(repoRelativePath: string): Promise<string | undefined> {
  try {
    const bytes = await Deno.readFile(join(REPO_ROOT, repoRelativePath));
    // A NUL byte within the first few KB is the standard cheap binary-file heuristic; skip
    // full decode for large binaries (a 37MB accidental venv patch should be scanned fast,
    // but a genuinely binary blob has no diff headers to find anyway).
    const sniffLen = Math.min(bytes.length, 8192);
    if (bytes.subarray(0, sniffLen).includes(0)) return undefined;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

function formatViolation(v: IRuntimeArtifactViolation): string {
  if (v.kind === "staged-file") {
    return `  ${v.stagedPath}  (staged file lives under a runtime-artifact path)`;
  }
  return `  ${v.stagedPath}  → embeds runtime-artifact path "${v.artifactPath}" in its diff content`;
}

async function main(): Promise<void> {
  const files = await stagedFiles();
  const entries = await Promise.all(files.map(async (path) => ({
    path,
    content: await readStagedTextContent(path),
  })));
  const violations = findRuntimeArtifactViolations(entries);

  if (violations.length === 0) {
    console.log("✅ No runtime/dependency-manager artifacts in staged files.");
    return;
  }

  console.error(`❌ ${violations.length} runtime-artifact violation(s) in staged files:\n`);
  for (const v of violations) {
    console.error(formatViolation(v));
  }
  console.error(
    "\nvenv/, __pycache__/, node_modules/, and similar generated directories must never be " +
      "committed — including inside a vendored .patch/.diff file's own diff hunks (this is " +
      'how a single ingest run once vendored an entire 37.8MB Python venv as "real" task ' +
      "content). Unstage the offending path with `git restore --staged <path>`, or regenerate " +
      "the patch/fixture excluding it.",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
