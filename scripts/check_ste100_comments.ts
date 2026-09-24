#!/usr/bin/env -S deno run -A

/**
 * @module Ste100CommentsCheck
 * @path scripts/check_ste100_comments.ts
 * @description Phase 195 Step 6 — code-comment STE authoring gate. Parser-aware
 *   extraction of TS/TSX comment prose (line, block, inline, header, JSDoc) that ignores
 *   strings, regex literals, and template text, then runs the shared Issue 9 counting core
 *   (ste100_prose_rules) on each comment span. Supports a default full scan, a focused
 *   mode, and a staged-mode ratchet gating only comments on lines added by the staged
 *   diff. Exit 0 = clean; 1 = confirmed violation; 2 = read/parse error.
 * Usage:
 *   deno run -A scripts/check_ste100_comments.ts                 # full scan of owned roots
 *   deno run -A scripts/check_ste100_comments.ts --focused <path># scan one file/dir
 *   deno run -A scripts/check_ste100_comments.ts --staged         # gate staged TS/TSX diffs
 * @architectural-layer Script
 * @dependencies [@std/path, typescript]
 * @related-files ["scripts/ste100_prose_rules.ts", "tests/scripts/check_ste100_comments_test.ts", "scripts/check_code_style.ts"]
 */

import { join } from "@std/path";
import ts from "typescript";
import type { Opt, Reason } from "@exaix/core/types";
import { normalizeSteProse, runDeterministicSteChecks, stripProseMarkers } from "./ste100_prose_rules.ts";
import type { FindingSeverity, ISteFinding } from "./ste100_prose_rules.ts";

/** A single extracted comment span, with prose and a one-based source line. */
export interface ICommentSpan {
  /** One-based line of the comment's first prose line. */
  line: number;
  /** Declares the actual comment text (including delimiters) for tests. */
  raw: string;
  /** Delimiter-stripped prose passed to the STE core. */
  prose: string;
}

export interface ICommentFinding {
  path: string;
  line: number;
  column: number;
  ruleId: string;
  severity: FindingSeverity;
  message: string;
}

export interface ISteCommentsCheckResult {
  exitCode: number;
  findings: ICommentFinding[];
  files: number;
  errors: string[];
}

export interface ISteCommentsCheckOptions {
  focused?: string[];
  staged?: boolean;
}

/** Owned TS/TSX roots scanned in the default full-scan mode (skip on error). */
function ownedRoots(): string[] {
  return ["packages", "apps", "scripts", "migrations", "exaix-team"];
}

/** Directives and tag-only prefixes whose comment prose is preserved, not gated. */
const PRESERVED_COMMENT_PREFIXES = [
  "deno-lint-ignore",
  "ts-expect-error",
  "ts-ignore",
  "ts-nocheck",
  "noinspection",
  "eslint-disable",
  "prettier-ignore",
  "eslint-enable",
  "cspell:disable",
];

/** True when a stripped comment carries no gatable prose (only directives/tags/literals). */
function isPreservedComment(prose: string): boolean {
  const trimmed = prose.trim();
  if (trimmed.length === 0) return true;
  const firstWord = trimmed.split(/\s+/, 1)[0]?.toLowerCase();
  if (firstWord && PRESERVED_COMMENT_PREFIXES.includes(firstWord.replace(/^[!@]/, ""))) return true;
  // Tag-only comment: every token starts with @ or is a bare identifier/type without spacing.
  if (/^@/.test(trimmed) || /^(?:@\w+(?:\s|$))/.test(trimmed)) return true;
  // Pure literal span: backticked command or bracketed reference only.
  if (/^`[^`]+`$/.test(trimmed) || /^\[[^\]]+\]$/.test(trimmed)) return true;
  // One word (identifier, type, single symbol) has no STE-countable sentence.
  return trimmed.split(/\s+/).length <= 1;
}

/** Parser-aware extraction of TS/TSX comment prose using the TypeScript scanner.
 *  Consecutive single-line comments on adjacent lines are grouped into one span so a
 *  wrapped sentence is counted as one paragraph. */
export function extractCommentSpans(source: string, _path: string): ICommentSpan[] {
  interface RawComment {
    line: number;
    raw: string;
    prose: string;
  }
  // The raw scanner mishandles consecutive template literals.
  // It yields a comment token for `// ` inside a template head
  // after a prior template substitution. The parse-tree range
  // APIs handle strings and template text correctly instead.
  const sourceFile = ts.createSourceFile(_path, source, ts.ScriptTarget.Latest, true);
  const byStart = new Map<number, RawComment>();
  const collect = (_node: ts.Node, isTrailing: boolean, offset: number): void => {
    const ranges = isTrailing
      ? ts.getTrailingCommentRanges(source, offset)
      : ts.getLeadingCommentRanges(source, offset);
    for (const range of ranges ?? []) {
      const raw = source.slice(range.pos, range.end);
      const isBlock = raw.startsWith("/");
      let line = getLineNumber(source, range.pos);
      if (isBlock && raw.includes("\n")) {
        const rawLines = raw.split(/\r?\n/);
        for (let i = 1; i < rawLines.length; i++) {
          if (stripCommentDelimiters(rawLines[i]).trim().length > 0) {
            line += i;
            break;
          }
        }
      }
      byStart.set(range.pos, {
        line,
        raw,
        prose: stripCommentDelimiters(raw).trim(),
      });
    }
  };
  const walk = (node: ts.Node): void => {
    collect(node, false, node.getFullStart());
    collect(node, true, node.end);
    ts.forEachChild(node, walk);
  };
  collect(sourceFile, false, 0);
  walk(sourceFile);
  const rawComments = [...byStart.values()].sort((a, b) => a.line - b.line);

  // Group adjacent single-line comments, so a wrapped sentence
  // counts as one paragraph. Block comments stand alone.
  const spans: ICommentSpan[] = [];
  let run: RawComment[] = [];
  let runStartLine = -1;
  const flushRun = () => {
    if (run.length === 0) return;
    const merged: RawComment = {
      line: runStartLine,
      raw: run.map((r) => r.raw).join("\n"),
      prose: run.map((r) => r.prose).join("\n"),
    };
    if (!isPreservedComment(merged.prose)) spans.push(merged);
    run = [];
  };
  for (const rc of rawComments) {
    const isSingle = !rc.raw.includes("\n") && rc.raw.startsWith("//");
    if (!isSingle) {
      flushRun();
      if (!isPreservedComment(rc.prose)) spans.push({ line: rc.line, raw: rc.raw, prose: rc.prose });
      continue;
    }
    if (run.length === 0) {
      runStartLine = rc.line;
      run = [rc];
    } else if (run[run.length - 1].line + 1 === rc.line) {
      run.push(rc);
    } else {
      flushRun();
      runStartLine = rc.line;
      run = [rc];
    }
  }
  flushRun();
  return spans;
}

/** Strips line-comment and block-comment delimiters, plus per-line JSDoc leading asterisks. */
function stripCommentDelimiters(raw: string): string {
  if (raw.startsWith("//")) return raw.slice(2).trim();
  let inner = raw
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .trim();
  inner = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*?\s?/, ""))
    .join("\n");
  return inner;
}

/** One-based line number of a character offset. */
function getLineNumber(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Runs the shared STE core on one comment's prose. */
function steFindingsForProse(prose: string): ISteFinding[] {
  return runDeterministicSteChecks(normalizeSteProse(stripProseMarkers(prose)));
}

/**
 * Checks one source file's comments. The staged ratchet supplies an added-lines set.
 * Only comments whose line is in that set gate. Every span is checked otherwise.
 */
export function checkText(
  source: string,
  path: string,
  addedLines?: Opt<Set<number>, Reason.OptionalContext>,
): { findings: ICommentFinding[]; spans: ICommentSpan[] } {
  const spans = extractCommentSpans(source, path);
  const findings: ICommentFinding[] = [];
  for (const span of spans) {
    if (addedLines && !addedLines.has(span.line)) continue;
    for (const f of steFindingsForProse(span.prose)) {
      const column = findProseColumn(source, span, f.sentence);
      findings.push({
        path,
        line: span.line,
        column,
        ruleId: f.ruleId,
        severity: f.severity,
        message: f.message,
      });
    }
  }
  return { findings, spans };
}

/** Best-effort column of the sentence's first token in the original line. */
function findProseColumn(source: string, span: ICommentSpan, sentence: string): number {
  const start = source.indexOf(span.prose);
  if (start < 0) return 1;
  const firstWord = sentence.trim().split(/\s+/, 1)[0];
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const colInProse = span.prose.indexOf(firstWord ?? "");
  return colInProse >= 0 ? colInProse + 1 : start - lineStart + 1;
}

/** Parses `git diff --unified=0` output into the set of added (new-file) line numbers. */
export function parseChangedLinesFromUnifiedDiff(diff: string): Set<number> {
  const added = new Set<number>();
  let newLine = 0;
  for (const rawLine of diff.split("\n")) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (rawLine.startsWith("+++")) continue;
    if (rawLine.startsWith("---")) continue;
    if (rawLine.startsWith("+")) {
      added.add(newLine);
      newLine++;
    } else if (rawLine.startsWith("-")) {
      // no new-file line consumed
    } else {
      newLine++;
    }
  }
  return added;
}

async function stagedTsFiles(): Promise<string[]> {
  const out = await new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    // LD_LIBRARY_PATH must be scrubbed when spawning subprocesses under restricted
    // permissions — matches scripts/check_optional_params.ts.
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return [];
  return new TextDecoder().decode(out.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".ts") || l.endsWith(".tsx"))
    .filter((l) => !l.includes("/.copilot/") && !l.includes("/.exa/"));
}

async function addedLinesForFile(file: string): Promise<Set<number>> {
  const out = await new Deno.Command("git", {
    args: ["diff", "--cached", "--unified=0", "--", file],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return new Set();
  return parseChangedLinesFromUnifiedDiff(new TextDecoder().decode(out.stdout));
}

async function checkFile(
  file: string,
  addedLines?: Opt<Set<number>, Reason.OptionalContext>,
): Promise<ICommentFinding[]> {
  const source = await Deno.readTextFile(file);
  const { findings } = checkText(source, file, addedLines);
  return findings;
}

async function collectOwnedTsFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of ownedRoots()) {
    try {
      for await (const entry of Deno.readDir(root)) {
        if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
        files.push(join(root, entry.name));
      }
    } catch {
      // owned root absent (e.g. submodule not checked out)
    }
  }
  return files;
}

/**
 * Runs the comment STE gate. The staged mode gates only the added and changed comment
 * lines of staged files. The focused mode checks given files in full. The default mode
 * scans owned roots and reports.
 */
export async function runSte100CommentsCheck(
  options: ISteCommentsCheckOptions = {},
): Promise<ISteCommentsCheckResult> {
  const errors: string[] = [];
  const findings: ICommentFinding[] = [];
  let files = 0;

  try {
    if (options.staged) {
      const staged = await stagedTsFiles();
      for (const file of staged) {
        const added = await addedLinesForFile(file);
        findings.push(...await checkFile(file, added));
        files++;
      }
    } else if (options.focused) {
      for (const target of options.focused) {
        for (const file of await expandTarget(target)) {
          findings.push(...await checkFile(file));
          files++;
        }
      }
    } else {
      for (const file of await collectOwnedTsFiles()) {
        findings.push(...await checkFile(file));
        files++;
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    exitCode: errors.length > 0 ? 2 : findings.length > 0 ? 1 : 0,
    findings,
    files,
    errors,
  };
}

async function expandTarget(target: string): Promise<string[]> {
  const stat = await Deno.stat(target);
  if (!stat.isDirectory) return [target];
  const out: string[] = [];
  for await (const entry of Deno.readDir(target)) {
    if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(join(target, entry.name));
    }
  }
  return out;
}

if (import.meta.main) {
  const args = Deno.args;
  const options: ISteCommentsCheckOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--staged") options.staged = true;
    if (args[i] === "--focused" && args[i + 1]) {
      options.focused = [...(options.focused ?? []), args[i + 1]];
      i++;
    }
  }
  runSte100CommentsCheck(options).then(
    (result) => {
      for (const error of result.errors) console.error(`  - ${error}`);
      for (const f of result.findings) {
        console.error(
          `  - [${f.severity}] ${f.path}:${f.line}:${f.column} ${f.ruleId} — ${f.message}`,
        );
      }
      console.error(
        `ste100-comments: exit ${result.exitCode} — ${result.findings.length} finding(s), ${result.files} file(s) checked, ${result.errors.length} error(s)`,
      );
      Deno.exit(result.exitCode);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(2);
    },
  );
}
