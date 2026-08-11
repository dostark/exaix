#!/usr/bin/env -S deno run -A
/**
 * @module MarkdownLint
 * @path scripts/markdown_lint.ts
 * @description A lightweight markdown linter used by dev-time agents and repo tooling.
 *
 * Usage:
 *   deno run --allow-read scripts/markdown_lint.ts
 *   deno run --allow-read scripts/markdown_lint.ts docs/some.md .copilot/
 *   deno run --allow-read --allow-write scripts/markdown_lint.ts --fix
 */

import { walk } from "@std/fs";
import { extname, join, normalize } from "@std/path";
import { MarkdownListKind, Severity } from "@exaix/core";

export interface IFinding {
  filePath: string;
  line: number; // 1-based
  rule: string;
  severity: Severity;
  message: string;
}

export interface ILintOptions {
  fix: boolean;
  strict: boolean;
  verbose: boolean;
}

const DEFAULT_ROOTS: readonly string[] = [
  // Keep the default scope focused on repo-maintained docs.
  // Large/legacy doc trees (e.g. docs/) should be linted explicitly by passing
  // paths on the command line.
  ".copilot",
  "Blueprints",
  "README.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
];

const SKIP_DIRS = new Set([
  ".git",
  ".ai",
  ".anthropic",
  ".claude",
  ".cursor",
  "node_modules",
  "dist",
  "coverage",
  "cov_profile",
  "Workspace",
  "Memory",
  "logs",
]);

function parseArgs(args: string[]): { options: ILintOptions; paths: string[] } {
  const options: ILintOptions = { fix: false, strict: false, verbose: false };
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === "--fix") options.fix = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      Deno.exit(0);
    } else {
      paths.push(arg);
    }
  }

  return { options, paths };
}

function printHelp(): void {
  console.log(
    `Markdown lint\n\nUsage:\n  deno run --allow-read scripts/markdown_lint.ts [paths...]\n\nOptions:\n  --fix       Apply auto-fixes for safe violations (MD001, MD009, MD003, MD004, MD012, MD022, MD025, MD026, MD029, MD031, MD032, MD036, MD040, MD041, MD049, MD060)\n  --strict    Treat warnings as errors\n  --verbose   Print file-level progress\n  --help      Show help\n\nIf no paths are provided, defaults to: ${
      DEFAULT_ROOTS.join(", ")
    }`,
  );
}

/** Vendored task-environment portals (`fixtures/portals/**`) are materialized, arbitrary
 *  externally-sourced content (Phase 144: a Terminal-Bench/SWE-bench task's own working-dir
 *  files, bind-mounted verbatim) — never Exaix-authored documentation prose. A `.md`
 *  extension there is incidental to the vendored task, not a doc; linting (or "fixing") it
 *  would mutate byte-for-byte vendored fixtures the reference.patch/oracle controls were
 *  computed against. Excluded from both the directory walk and explicit file-path args. */
const VENDORED_PORTAL_MARKER = "/fixtures/portals/";

function isVendoredPortalContent(path: string): boolean {
  return normalize(path).includes(VENDORED_PORTAL_MARKER);
}

function isMarkdownFile(path: string): boolean {
  return extname(path).toLowerCase() === ".md" && !isVendoredPortalContent(path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function collectMarkdownFiles(inputPaths: string[]): Promise<string[]> {
  const files: string[] = [];
  const roots = inputPaths.length > 0 ? inputPaths : [...DEFAULT_ROOTS];

  for (const raw of roots) {
    const p = normalize(raw);
    if (!(await pathExists(p))) continue;

    const stat = await Deno.stat(p);
    if (stat.isFile) {
      if (isMarkdownFile(p)) files.push(p);
      continue;
    }

    for await (
      const entry of walk(p, {
        includeDirs: false,
        followSymlinks: false,
        exts: ["md"],
        skip: [
          // Skip hidden dirs and known large dirs.
          new RegExp(`${join(p, "\\.git")}`),
        ],
      })
    ) {
      const parts = entry.path.split("/");
      if (parts.some((seg) => SKIP_DIRS.has(seg))) continue;
      files.push(entry.path);
    }
  }

  // De-dup + stable sort
  return Array.from(new Set(files)).sort();
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

/**
 * Applies `fn` only to the segments of `line` OUTSIDE backtick inline code spans, leaving
 * code-span content (delimiters included) byte-for-byte untouched. Used by fixers whose
 * rewrite regex (e.g. MD049's underscore-to-asterisk emphasis conversion) would otherwise
 * misparse underscores inside identifiers like `` `CI_EXCLUDED_TAGS` `` as emphasis markup —
 * the 2026-08-10 corruption incident this guards against.
 */
function applyOutsideCodeSpans(line: string, fn: (segment: string) => string): string {
  let result = "";
  let cursor = 0;
  let inCodeSpan = false;
  let codeSpanTicks = 0;
  let segmentStart = 0;

  while (cursor < line.length) {
    if (line[cursor] === "`") {
      let j = cursor;
      while (j < line.length && line[j] === "`") j++;
      const tickCount = j - cursor;

      if (!inCodeSpan) {
        result += fn(line.slice(segmentStart, cursor));
        inCodeSpan = true;
        codeSpanTicks = tickCount;
        segmentStart = cursor;
      } else if (tickCount === codeSpanTicks) {
        result += line.slice(segmentStart, j);
        inCodeSpan = false;
        codeSpanTicks = 0;
        segmentStart = j;
      }
      cursor = j;
      continue;
    }
    cursor += 1;
  }

  result += inCodeSpan ? line.slice(segmentStart) : fn(line.slice(segmentStart));
  return result;
}

type Fence = { char: "`" | "~"; length: number };

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // If it's malformed, keep as-is and let the checker fail.
    return fragment;
  }
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function githubSlugify(raw: string, used: Map<string, number>): string {
  const text = stripMarkdownInline(raw)
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/^-|-$/g, "");

  const base = text;
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  if (count === 0) return base;
  return `${base}-${count}`;
}

function getIndentWidth(line: string): number {
  return (line.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "  ").length;
}

function parseListMarker(line: string): { kind: MarkdownListKind; indent: number } | null {
  const ul = /^(?<indent>\s*)[-+*]\s+/.exec(line);
  if (ul?.groups) return { kind: MarkdownListKind.UL, indent: getIndentWidth(line) };

  const ol = /^(?<indent>\s*)(?<num>\d+)[.)]\s+/.exec(line);
  if (ol?.groups) return { kind: MarkdownListKind.OL, indent: getIndentWidth(line) };

  return null;
}

function looksLikeListContinuation(line: string): boolean {
  // Heuristic: indented content is typically part of the preceding list item.
  // This is intentionally conservative to avoid false-positive MD032.
  return /^\s{2,}\S/.test(line) && !parseListMarker(line);
}

function parseEmphasisOnlyLine(trimmed: string): { inner: string } | null {
  if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
    return { inner: trimmed.slice(2, -2) };
  }
  if (trimmed.startsWith("__") && trimmed.endsWith("__") && trimmed.length > 4) {
    return { inner: trimmed.slice(2, -2) };
  }
  if (
    trimmed.startsWith("*") && !trimmed.startsWith("**") && trimmed.endsWith("*") &&
    !trimmed.endsWith("**") && trimmed.length > 2
  ) {
    return { inner: trimmed.slice(1, -1) };
  }
  if (
    trimmed.startsWith("_") && !trimmed.startsWith("__") && trimmed.endsWith("_") &&
    !trimmed.endsWith("__") && trimmed.length > 2
  ) {
    return { inner: trimmed.slice(1, -1) };
  }
  return null;
}

function parseFenceStart(line: string): Fence | null {
  const trimmed = line.trimStart();
  const match = /^(?<ticks>`{3,})|^(?<tildes>~{3,})/.exec(trimmed);
  if (!match) return null;

  const ticks = match.groups?.ticks;
  if (ticks) return { char: "`", length: ticks.length };

  const tildes = match.groups?.tildes;
  if (tildes) return { char: "~", length: tildes.length };

  return null;
}

function isTableSeparatorRow(line: string): boolean {
  // Allow single-dash separators (e.g. `| - |`) as well as multi-dash (e.g. `| --- |`).
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function normalizeSeparatorCell(cell: string): string {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  const hyphenCount = (trimmed.match(/-/g) || []).length;
  const dashes = "-".repeat(Math.max(3, hyphenCount || 3));
  return `${left ? ":" : ""}${dashes}${right ? ":" : ""}`;
}

function normalizeTableRowCompact(row: string, separatorRow: boolean): string {
  const trimmed = row.trim();
  const hasLeadingPipe = trimmed.startsWith("|");
  const hasTrailingPipe = trimmed.endsWith("|");

  let core = trimmed;
  if (hasLeadingPipe) core = core.slice(1);
  if (hasTrailingPipe) core = core.slice(0, -1);

  const rawCells = core.split("|");
  const cells = separatorRow
    ? rawCells.map((cell) => normalizeSeparatorCell(cell))
    : rawCells.map((cell) => cell.trim());

  return `| ${cells.join(" | ")} |`;
}

function isFenceClose(line: string, fence: Fence): boolean {
  const trimmed = line.trimStart();
  const closeMatch = new RegExp(`^${fence.char}{${fence.length},}(?:\\s*)$`).exec(
    trimmed,
  );
  return closeMatch !== null;
}

function applySafeFixes(original: string): { fixed: string; changed: boolean } {
  // Normalize newlines first.
  let text = original.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  const lines = splitLines(text);
  const out: string[] = [];

  let inFence = false;
  let fence: Fence | null = null;
  let blankRun = 0;

  for (const line of lines) {
    const fenceStart = parseFenceStart(line);
    if (fenceStart) {
      if (!inFence) {
        inFence = true;
        fence = fenceStart;
      } else if (fence && isFenceClose(line, fence)) {
        inFence = false;
        fence = null;
      }

      // Preserve fence lines (after trimming trailing whitespace).
      out.push(line.replace(/[ \t]+$/g, ""));
      blankRun = 0;
      continue;
    }

    const trimmedTrailing = line.replace(/[ \t]+$/g, "");

    // Inside fenced code blocks, preserve content as-is (only trim trailing ws).
    if (inFence) {
      out.push(trimmedTrailing);
      blankRun = 0;
      continue;
    }

    if (trimmedTrailing === "") {
      blankRun++;
      // MD012: collapse runs of blank lines to at most 1 (outside fences only).
      if (blankRun <= 1) out.push("");
      continue;
    }

    blankRun = 0;

    out.push(trimmedTrailing);
  }

  text = out.join("\n");

  // Ensure exactly one newline at EOF.
  text = text.replace(/\n*$/, "\n");

  return { fixed: text, changed: text !== original };
}

export function applySpecificFixes(content: string, findings: IFinding[]): { fixed: string; changed: boolean } {
  let text = content;
  let changed = false;

  // Fix MD032: blanks around lists
  const md032Fixes = findings.filter((f) => f.rule === "MD032/blanks-around-lists");
  if (md032Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const listMarker = parseListMarker(line);

      // Check if this line has a top-level list marker
      if (listMarker && listMarker.indent === 0) {
        // Add blank line before if previous line is not blank and not part of list
        if (
          i > 0 && lines[i - 1].trim() !== "" && !parseListMarker(lines[i - 1]) &&
          !looksLikeListContinuation(lines[i - 1]) && !lines[i - 1].trimStart().startsWith(">")
        ) {
          newLines.push("");
          changed = true;
        }
      }

      newLines.push(line);

      // Add blank line after if next line is not blank and not part of list
      if (listMarker && listMarker.indent === 0) {
        if (
          i + 1 < lines.length && lines[i + 1].trim() !== "" && !parseListMarker(lines[i + 1]) &&
          !looksLikeListContinuation(lines[i + 1]) && !lines[i + 1].trimStart().startsWith(">")
        ) {
          newLines.push("");
          changed = true;
          i++; // Skip the next line since we just added it
        }
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD029: ordered list prefixes
  const md029Fixes = findings.filter((f) => f.rule === "MD029/ol-prefix");
  if (md029Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    for (const line of lines) {
      const match = /^(?<indent>\s*)(?<num>\d+)(?<after>[.)]\s+)/.exec(line);
      if (match && match.groups && match.groups.num !== "1") {
        const { indent, num, after } = match.groups;
        // Replace ONLY the leading number with "1", preserving the delimiter,
        // whitespace, and — crucially — the rest of the line (the item body).
        const body = line.slice(indent.length + num.length + after.length);
        newLines.push(indent + "1" + after + body);
        changed = true;
      } else {
        newLines.push(line);
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD001/heading-increment: demote headings that skip levels
  const md001Fixes = findings.filter((f) => f.rule === "MD001/heading-increment");
  if (md001Fixes.length > 0) {
    const lines = splitLines(text);
    for (const fix of md001Fixes) {
      const idx = fix.line - 1;
      if (idx < 0 || idx >= lines.length) continue;
      // Extract expected level from message: "[Expected: hN; Actual: hM]"
      const expectedMatch = /\[Expected: h(\d); Actual: h(\d)\]/.exec(fix.message);
      if (!expectedMatch) continue;
      const expectedLevel = parseInt(expectedMatch[1]);
      const actualLevel = parseInt(expectedMatch[2]);
      if (actualLevel <= expectedLevel) continue;
      const line = lines[idx];
      const headingMatch = /^(#{1,6})(\s+.*)$/.exec(line);
      if (!headingMatch) continue;
      lines[idx] = "#".repeat(expectedLevel) + headingMatch[2];
      changed = true;
    }
    text = lines.join("\n");
  }

  // Fix MD026: trailing punctuation in headings
  const md026Fixes = findings.filter((f) => f.rule === "MD026/no-trailing-punctuation");
  if (md026Fixes.length > 0) {
    const lines = splitLines(text);
    const targetLines = new Set(md026Fixes.map((f) => f.line));

    for (const lineNo of targetLines) {
      const idx = lineNo - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const line = lines[idx];
      if (/^#{1,6}\s+/.test(line)) {
        lines[idx] = line.replace(/[.,:;!?。，；：！？]+\s*$/, "");
        changed = true;
      }
    }

    text = lines.join("\n");
  }

  // Fix MD025: multiple top-level headings by demoting H1 to H2
  const md025Fixes = findings.filter((f) => f.rule === "MD025/single-title/single-h1");
  if (md025Fixes.length > 0) {
    const lines = splitLines(text);
    const targetLines = new Set(md025Fixes.map((f) => f.line));

    for (const lineNo of targetLines) {
      const idx = lineNo - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const line = lines[idx];
      if (/^#\s+/.test(line)) {
        lines[idx] = line.replace(/^#\s+/, "## ");
        changed = true;
      }
    }

    text = lines.join("\n");
  }

  // Fix MD060: table column style
  const md060Fixes = findings.filter((f) => f.rule === "MD060/table-column-style");
  if (md060Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines = [...lines];

    for (let i = 0; i + 1 < lines.length; i++) {
      const header = lines[i];
      const separator = lines[i + 1];

      if (!header.includes("|") || !isTableSeparatorRow(separator)) {
        continue;
      }

      let rowIndex = i;
      while (rowIndex < lines.length) {
        const row = lines[rowIndex];
        if (row.trim() === "" || !row.includes("|")) break;

        const normalized = normalizeTableRowCompact(row, isTableSeparatorRow(row));
        if (normalized !== row) {
          newLines[rowIndex] = normalized;
          changed = true;
        }

        rowIndex++;
      }

      i = Math.max(i, rowIndex - 1);
    }

    text = newLines.join("\n");
  }

  // Fix MD040: fenced code blocks without language
  const md040Fixes = findings.filter((f) => f.rule === "MD040/fenced-code-language");
  if (md040Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    for (const line of lines) {
      const fenceStart = parseFenceStart(line);
      if (fenceStart) {
        const trimmed = line.trimStart();
        const fenceToken = `${fenceStart.char}`.repeat(fenceStart.length);
        const info = trimmed.slice(fenceToken.length).trim();
        if (info.length === 0) {
          // Add "text" as default language
          newLines.push(line.replace(fenceToken, fenceToken + "text"));
          changed = true;
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD004: unclosed fenced code blocks
  const md004Fixes = findings.filter((f) => f.rule === "MD004");
  if (md004Fixes.length > 0) {
    // This is more complex - we need to find where the fence should be closed
    // For now, add a closing fence at the end of the file if it's unclosed
    const lines = splitLines(text);
    let inFence = false;
    let fence: Fence | null = null;
    const newLines: string[] = [];

    for (const line of lines) {
      const fenceStart = parseFenceStart(line);
      if (fenceStart && !inFence) {
        inFence = true;
        fence = fenceStart;
      } else if (fence && isFenceClose(line, fence)) {
        inFence = false;
        fence = null;
      }
      newLines.push(line);
    }

    // If still in a fence at the end, add a closing fence
    if (inFence && fence) {
      newLines.push(`${fence.char}`.repeat(fence.length));
      changed = true;
    }

    text = newLines.join("\n");
  }

  // Fix MD036: emphasis used instead of heading
  const md036Fixes = findings.filter((f) => f.rule === "MD036/no-emphasis-as-heading");
  if (md036Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const emphasis = parseEmphasisOnlyLine(trimmed);
      if (emphasis) {
        // Convert to heading
        newLines.push(`# ${emphasis.inner}`);
        changed = true;
      } else {
        newLines.push(line);
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD049: emphasis style (convert underscores to asterisks). Fenced code blocks are
  // skipped entirely and inline backtick code spans are protected via applyOutsideCodeSpans —
  // an identifier like `CI_EXCLUDED_TAGS` must never be misparsed as emphasis markup (2026-08-10
  // corruption incident: this exact bug turned it into `CI*EXCLUDED*TAGS`).
  const md049Fixes = findings.filter((f) => f.rule === "MD049/emphasis-style");
  if (md049Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];
    let inFenceLocal = false;
    let fenceLocal: Fence | null = null;

    for (const line of lines) {
      const fenceStart = parseFenceStart(line);
      if (fenceStart && !inFenceLocal) {
        inFenceLocal = true;
        fenceLocal = fenceStart;
        newLines.push(line);
        continue;
      }
      if (fenceStart && inFenceLocal && fenceLocal && isFenceClose(line, fenceLocal)) {
        inFenceLocal = false;
        fenceLocal = null;
        newLines.push(line);
        continue;
      }
      if (inFenceLocal) {
        newLines.push(line);
        continue;
      }

      // Convert __text__ to **text** and _text_ to *text*, only outside code spans.
      const fixedLine = applyOutsideCodeSpans(line, (segment) => {
        let converted = segment.replace(/__([^_]+)__/g, "**$1**");
        converted = converted.replace(/_([^_]+)_/g, "*$1*");
        return converted;
      });
      newLines.push(fixedLine);
      if (fixedLine !== line) {
        changed = true;
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD031: blanks around fences
  const md031Fixes = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  if (md031Fixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    let inFenceLocal = false;
    let fenceLocal: Fence | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fStart = parseFenceStart(line);

      if (fStart && !inFenceLocal) {
        // Opening fence: ensure blank line before if previous is non-blank.
        if (i > 0 && lines[i - 1].trim() !== "") {
          newLines.push("");
          changed = true;
        }
        inFenceLocal = true;
        fenceLocal = fStart;
        newLines.push(line);
        continue;
      }

      if (fStart && inFenceLocal && fenceLocal && isFenceClose(line, fenceLocal)) {
        // Closing fence: push it, then ensure blank line after if next is non-blank.
        inFenceLocal = false;
        fenceLocal = null;
        newLines.push(line);
        if (i + 1 < lines.length && lines[i + 1].trim() !== "") {
          newLines.push("");
          changed = true;
        }
        continue;
      }

      newLines.push(line);
    }

    text = newLines.join("\n");
  }

  // Fix MD022: heading blank lines
  const headingFixes = findings.filter((f) =>
    f.rule === "MD022/blanks-around-headings" || f.rule === "MD010" || f.rule === "MD011"
  );
  if (headingFixes.length > 0) {
    const lines = splitLines(text);
    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeading = /^#{1,6} /.test(line);

      if (isHeading) {
        // MD022: Add blank line before heading if missing
        if (i > 0 && lines[i - 1].trim() !== "") {
          newLines.push("");
          changed = true;
        }
      }

      newLines.push(line);

      if (isHeading) {
        // MD022: Add blank line after heading if missing
        if (i + 1 < lines.length && lines[i + 1].trim() !== "") {
          newLines.push("");
          changed = true;
          i++; // Skip the next line since we just added it
        }
      }
    }

    text = newLines.join("\n");
  }

  // Fix MD041: first line in file should be a top-level heading
  const md041Fixes = findings.filter((f) => f.rule === "MD041/first-line-heading/first-line-h1");
  if (md041Fixes.length > 0) {
    const lines = splitLines(text);
    const targetLines = new Set(md041Fixes.map((f) => f.line));

    for (const lineNo of targetLines) {
      const idx = lineNo - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const line = lines[idx];
      if (/^#{2,6}\s+/.test(line)) {
        lines[idx] = line.replace(/^#{2,6}\s+/, "# ");
        changed = true;
      }
    }

    text = lines.join("\n");
  }

  return { fixed: text, changed };
}

export function lintMarkdown(content: string, filePath: string, options: ILintOptions): IFinding[] {
  const findings: IFinding[] = [];

  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = splitLines(normalized);

  let inFence = false;
  let fence: Fence | null = null;
  let fenceStartLine = 0;

  const lineIsInFence: boolean[] = new Array(lines.length).fill(false);

  let hasFrontMatterTitle = false;
  let frontMatterEndLine = -1;
  if (lines.length > 0 && lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "---" || trimmed === "...") {
        frontMatterEndLine = i;
        break;
      }
      if (/^title\s*:/i.test(lines[i])) {
        hasFrontMatterTitle = true;
      }
    }
  }

  let topLevelHeadingCount = 0;
  // MD001/heading-increment: tracks the last seen heading level (0 = none yet).
  let lastHeadingLevel = 0;

  // MD051: link fragments should resolve to known heading/html anchors.
  const headingIdUsed = new Map<string, number>();
  const knownFragments = new Set<string>();

  // MD012: no multiple consecutive blank lines (outside fenced code blocks).
  let blankRunOutsideFence = 0;

  // MD007: track unordered list indentation depth.
  const ulIndentStack: number[] = [];

  // MD029: warn once per ordered-list block (per indent) to reduce noise.
  const olPrefixWarnedAtIndent = new Set<number>();

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];
    const isSyntheticTerminalBlank = idx === lines.length - 1 &&
      line === "" &&
      normalized.endsWith("\n");

    lineIsInFence[idx] = inFence;

    const fenceStart = parseFenceStart(line);
    if (fenceStart) {
      if (!inFence) {
        inFence = true;
        fence = fenceStart;
        fenceStartLine = lineNo;

        // MD031/blanks-around-fences: opening fence should be preceded by a blank line.
        if (idx > 0 && lines[idx - 1].trim() !== "") {
          // Exception: don't flag if the preceding line is the frontmatter closing ---.
          const isFrontMatterClose = frontMatterEndLine >= 0 && idx - 1 === frontMatterEndLine;
          if (!isFrontMatterClose) {
            findings.push({
              filePath,
              line: lineNo,
              rule: "MD031/blanks-around-fences",
              severity: options.strict ? Severity.ERROR : Severity.WARN,
              message: "Fenced code blocks should be surrounded by blank lines",
            });
          }
        }

        // MD040/fenced-code-language: require language on opening fence.
        const trimmed = line.trimStart();
        const fenceToken = `${fenceStart.char}`.repeat(fenceStart.length);
        const info = trimmed.slice(fenceToken.length).trim();
        if (info.length === 0) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD040/fenced-code-language",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: "Fenced code blocks should have a language specified",
          });
        }
      } else if (fence && isFenceClose(line, fence)) {
        inFence = false;
        fence = null;
        fenceStartLine = 0;

        // MD031/blanks-around-fences: closing fence should be followed by a blank line.
        const nextIdx = idx + 1;
        if (nextIdx < lines.length && lines[nextIdx].trim() !== "") {
          // Ignore synthetic terminal blank.
          const isSyntheticTerminal = nextIdx === lines.length - 1 &&
            lines[nextIdx] === "" && normalized.endsWith("\n");
          if (!isSyntheticTerminal) {
            findings.push({
              filePath,
              line: lineNo,
              rule: "MD031/blanks-around-fences",
              severity: options.strict ? Severity.ERROR : Severity.WARN,
              message: "Fenced code blocks should be surrounded by blank lines",
            });
          }
        }
      }
    }

    // Record again after state changes for this line.
    lineIsInFence[idx] = inFence;

    if (!inFence) {
      // Collect heading IDs (GitHub-style) and HTML anchors for MD051.
      const headingMatch = /^(?<hashes>#{1,6})\s+(?<text>.+?)\s*$/.exec(line);
      if (headingMatch?.groups?.text) {
        const headingText = headingMatch.groups.text.replace(/\s+#+\s*$/g, "").trim();
        const slug = githubSlugify(headingText, headingIdUsed);
        if (slug) knownFragments.add(slug);

        // MD049/emphasis-style: headings should prefer asterisk emphasis.
        if (/__[^_]+__/.test(headingText) || /_[^_]+_/.test(headingText)) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD049/emphasis-style",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: "Emphasis style [Expected: asterisk; Actual: underscore]",
          });
        }

        const headingLevel = headingMatch.groups.hashes.length;

        // MD001/heading-increment: heading levels should only increment by one level at a time.
        if (lastHeadingLevel > 0 && headingLevel > lastHeadingLevel + 1) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD001/heading-increment",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: `Heading levels should only increment by one level at a time [Expected: h${
              lastHeadingLevel + 1
            }; Actual: h${headingLevel}]`,
          });
        }
        lastHeadingLevel = headingLevel;

        // MD026/no-trailing-punctuation: headings should not end with punctuation.
        const plainText = stripMarkdownInline(headingText);
        if (/[.,:;!?。，；：！？]$/.test(plainText)) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD026/no-trailing-punctuation",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: `Trailing punctuation in heading [Punctuation: '${plainText.slice(-1)}']`,
          });
        }

        const isAfterFrontMatter = frontMatterEndLine === -1 || idx > frontMatterEndLine;
        if (isAfterFrontMatter && headingLevel === 1) {
          topLevelHeadingCount++;
          const invalidH1 = hasFrontMatterTitle || topLevelHeadingCount > 1;
          if (invalidH1) {
            findings.push({
              filePath,
              line: lineNo,
              rule: "MD025/single-title/single-h1",
              severity: options.strict ? Severity.ERROR : Severity.WARN,
              message: "Multiple top-level headings in the same document",
            });
          }
        }
      }

      const htmlIdMatch = /<a\s+[^>]*\b(?:id|name)="(?<id>[^"]+)"[^>]*>/i.exec(line);
      const htmlId = htmlIdMatch?.groups?.id?.trim();
      if (htmlId) knownFragments.add(htmlId);

      // MD036/no-emphasis-as-heading: emphasis-only line used like a heading.
      const trimmed = line.trim();
      const emphasis = parseEmphasisOnlyLine(trimmed);
      const innerText = emphasis?.inner.trim();
      const md036IgnorePunctuation = new Set([".", ",", ";", ":", "!", "?"]);
      const lastChar = innerText?.slice(-1);
      const looksLikeLabel = (lastChar && md036IgnorePunctuation.has(lastChar)) ?? false;
      if (emphasis && !looksLikeLabel && !/^#{1,6}\s+/.test(trimmed)) {
        findings.push({
          filePath,
          line: lineNo,
          rule: "MD036/no-emphasis-as-heading",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: "Emphasis used instead of a heading",
        });
      }

      // MD007/ul-indent: enforce 2-space indentation per nesting level.
      const ulMatch = /^(?<indent>\s*)(?<marker>[-+*])\s+/.exec(line);
      if (ulMatch?.groups) {
        const indent = ulMatch.groups.indent.replace(/\t/g, "  ").length;
        if (ulIndentStack.length === 0) {
          ulIndentStack.push(indent);
        } else {
          const current = ulIndentStack[ulIndentStack.length - 1];

          if (indent > current) {
            const expected = current + 2;
            if (indent !== expected) {
              findings.push({
                filePath,
                line: lineNo,
                rule: "MD007/ul-indent",
                severity: options.strict ? Severity.ERROR : Severity.WARN,
                message: `Unordered list indentation [Expected: 2; Actual: ${indent}]`,
              });
            }
            ulIndentStack.push(indent);
          } else {
            while (ulIndentStack.length > 0 && indent < ulIndentStack[ulIndentStack.length - 1]) {
              ulIndentStack.pop();
            }
            if (ulIndentStack.length === 0 || indent !== ulIndentStack[ulIndentStack.length - 1]) {
              ulIndentStack.push(indent);
            }
          }
        }
      } else if (line.trim() === "") {
        // Reset list tracking after a blank line.
        ulIndentStack.length = 0;
      }

      // MD032/blanks-around-lists: top-level lists should be surrounded by blank lines.
      // For nested lists (indent > 0), markdownlint does not require surrounding blank lines.
      const listMarker = parseListMarker(line);
      if (listMarker && listMarker.indent === 0) {
        const prev = idx > 0 ? lines[idx - 1] : "";
        if (
          idx > 0 && prev.trim() !== "" && !parseListMarker(prev) &&
          !looksLikeListContinuation(prev) &&
          !prev.trimStart().startsWith(">")
        ) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD032/blanks-around-lists",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: "Lists should be surrounded by blank lines",
          });
        }

        const next = idx + 1 < lines.length ? lines[idx + 1] : "";
        if (
          idx + 1 < lines.length && next.trim() !== "" && !parseListMarker(next) &&
          !looksLikeListContinuation(next) && !next.trimStart().startsWith(">")
        ) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD032/blanks-around-lists",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: "Lists should be surrounded by blank lines",
          });
        }
      }
    }

    if (inFence) {
      // Inside fenced code blocks, reset blank-line tracking (MD012 doesn't apply).
      blankRunOutsideFence = 0;
    } else if (isSyntheticTerminalBlank) {
      blankRunOutsideFence = 0;
    } else if (line.trim() === "") {
      blankRunOutsideFence++;
      if (blankRunOutsideFence > 1) {
        findings.push({
          filePath,
          line: lineNo,
          rule: "MD012/no-multiple-blanks",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: "Multiple consecutive blank lines",
        });
      }
    } else {
      blankRunOutsideFence = 0;
    }

    // MD009/no-trailing-spaces: trailing whitespace (fixable via applySafeFixes)
    if (/[ \t]+$/.test(line)) {
      findings.push({
        filePath,
        line: lineNo,
        rule: "MD009/no-trailing-spaces",
        severity: Severity.ERROR,
        message: "Trailing whitespace",
      });
    }

    // MD002: tabs outside fences (style)
    if (!inFence && /\t/.test(line)) {
      findings.push({
        filePath,
        line: lineNo,
        rule: "MD002",
        severity: options.strict ? Severity.ERROR : Severity.WARN,
        message: "Tab character found (prefer spaces)",
      });
    }

    // MD022: headings should be surrounded by blank lines (warn by default)
    if (!inFence && /^#{1,6} /.test(line)) {
      const prev = idx > 0 ? lines[idx - 1] : "";
      const next = idx + 1 < lines.length ? lines[idx + 1] : "";

      if (idx > 0 && prev.trim() !== "") {
        findings.push({
          filePath,
          line: lineNo,
          rule: "MD022/blanks-around-headings",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: "Heading should be preceded by a blank line",
        });
      }

      if (next.trim() !== "") {
        findings.push({
          filePath,
          line: lineNo,
          rule: "MD022/blanks-around-headings",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: "Heading should be followed by a blank line",
        });
      }
    }

    // MD029/ol-prefix: ordered list item prefix style 1/1/1
    // Enforce `1.` as the prefix for every ordered list item.
    if (!inFence) {
      // Reset list block tracking when leaving list context.
      const listMarker = parseListMarker(line);
      const continuation = looksLikeListContinuation(line);
      const isBlank = line.trim() === "";
      if (!isBlank && !continuation && listMarker === null) {
        olPrefixWarnedAtIndent.clear();
      }

      const match = /^\s*(?<num>\d+)[.)]\s+/.exec(line);
      const actual = match?.groups?.num;
      const indent = listMarker?.kind === "ol" ? listMarker.indent : 0;

      if (actual && actual !== "1" && !olPrefixWarnedAtIndent.has(indent)) {
        olPrefixWarnedAtIndent.add(indent);
        findings.push({
          filePath,
          line: lineNo,
          rule: "MD029/ol-prefix",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: `Ordered list item prefix [Expected: 1; Actual: ${actual}; Style: 1/1/1]`,
        });
      }
    }
  }

  // MD051/link-fragments: validate local (#fragment) links
  {
    const fragmentRe = /\]\(#(?<frag>[^)]+)\)/g;
    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const line = lines[idx];

      if (lineIsInFence[idx]) continue;

      let match: RegExpExecArray | null;
      while ((match = fragmentRe.exec(line)) !== null) {
        const rawFrag = match.groups?.frag?.trim();
        if (!rawFrag) continue;
        const frag = decodeFragment(rawFrag);
        if (!knownFragments.has(frag) && !knownFragments.has(frag.toLowerCase())) {
          findings.push({
            filePath,
            line: lineNo,
            rule: "MD051/link-fragments",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: "Link fragments should be valid",
          });
        }
      }
    }
  }

  // MD041/first-line-heading: require first non-blank line after frontmatter to be H1,
  // unless frontmatter already provides a title.
  if (!hasFrontMatterTitle) {
    const startIdx = frontMatterEndLine >= 0 ? frontMatterEndLine + 1 : 0;
    for (let idx = startIdx; idx < lines.length; idx++) {
      if (lineIsInFence[idx]) continue;
      const trimmed = lines[idx].trim();
      if (trimmed.length === 0) continue;
      if (/^<!--.*-->$/.test(trimmed)) continue;

      const headingMatch = /^(#{1,6})\s+/.exec(lines[idx]);
      const isH1 = headingMatch?.[1].length === 1;
      if (!isH1) {
        findings.push({
          filePath,
          line: idx + 1,
          rule: "MD041/first-line-heading/first-line-h1",
          severity: options.strict ? Severity.ERROR : Severity.WARN,
          message: "First line in a file should be a top-level heading",
        });
      }
      break;
    }
  }

  // MD060/table-column-style: enforce aligned table pipes.
  // Checks that the '|' characters align across header/separator/body rows.
  {
    const isEscapedAt = (s: string, index: number): boolean => {
      // A character is escaped if preceded by an odd number of backslashes.
      let count = 0;
      for (let i = index - 1; i >= 0 && s[i] === "\\"; i--) count++;
      return (count % 2) === 1;
    };

    const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;

    const isWideCodePoint = (cp: number): boolean => {
      // Approximate characters that most monospace editors render at 2 columns.
      // Markdownlint's MD060 uses visual width for aligned tables.
      if (
        (cp >= 0x1100 && cp <= 0x115F) ||
        (cp >= 0x2329 && cp <= 0x232A) ||
        (cp >= 0x2E80 && cp <= 0x303E) ||
        (cp >= 0x3040 && cp <= 0xA4CF) ||
        (cp >= 0xAC00 && cp <= 0xD7A3) ||
        (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFE10 && cp <= 0xFE19) ||
        (cp >= 0xFE30 && cp <= 0xFE6F) ||
        (cp >= 0xFF00 && cp <= 0xFF60) ||
        (cp >= 0xFFE0 && cp <= 0xFFE6)
      ) {
        return true;
      }
      return false;
    };

    const visualWidthOfCodePoint = (cp: number, ch: string): number => {
      // Variation Selector-16 and other selectors should not add visual width.
      if (cp === 0xFE0F) return 0;

      // Treat emoji/pictographic characters as double-width.
      if (EXTENDED_PICTOGRAPHIC_RE.test(ch)) return 2;

      return isWideCodePoint(cp) ? 2 : 1;
    };

    const pipeVisualPositions = (line: string): number[] => {
      // Positions are measured by visual columns (not string indices), ignoring
      // pipes inside inline code spans and escaped pipes.
      const positions: number[] = [];
      let column = 0;

      let inCodeSpan = false;
      let codeSpanTicks = 0;

      const openOrCloseCodeSpan = (tickCount: number) => {
        if (!inCodeSpan) {
          inCodeSpan = true;
          codeSpanTicks = tickCount;
          return;
        }

        if (tickCount === codeSpanTicks) {
          inCodeSpan = false;
          codeSpanTicks = 0;
        }
      };

      // Walk by code points, but also track string indices for escape handling.
      for (let i = 0; i < line.length;) {
        const cp = line.codePointAt(i) ?? 0;
        const ch = String.fromCodePoint(cp);
        const cpLen = ch.length;

        if (ch === "`") {
          // Count consecutive backticks for inline code span delimiter.
          let j = i;
          while (j < line.length && line[j] === "`") j++;
          const tickCount = j - i;
          openOrCloseCodeSpan(tickCount);
          column += tickCount; // backticks are 1-column each.
          i = j;
          continue;
        }

        if (!inCodeSpan && ch === "|" && !isEscapedAt(line, i)) {
          positions.push(column);
        }

        column += visualWidthOfCodePoint(cp, ch);
        i += cpLen;
      }

      return positions;
    };

    const rowMatchesTight = (row: string): boolean => {
      if (!row.includes("|")) return false;
      const trimmed = row.trim();
      // No spaces adjacent to any pipe.
      if (/\s\|/.test(trimmed) || /\|\s/.test(trimmed)) return false;
      return true;
    };

    const rowMatchesCompact = (row: string): boolean => {
      if (!row.includes("|")) return false;
      const trimmed = row.trim();
      const hasLeadingPipe = trimmed.startsWith("|");
      const hasTrailingPipe = trimmed.endsWith("|");
      let core = trimmed;
      if (hasLeadingPipe) core = core.slice(1);
      if (hasTrailingPipe) core = core.slice(0, -1);

      const parts = core.split("|");
      if (parts.length < 2) return false;

      for (let c = 0; c < parts.length; c++) {
        const cell = parts[c];
        const isFirst = c === 0;
        const isLast = c === parts.length - 1;

        const startsWithSpace = cell.startsWith(" ");
        const startsWithTwoSpaces = cell.startsWith("  ");
        const endsWithSpace = cell.endsWith(" ");
        const endsWithTwoSpaces = cell.endsWith("  ");

        if (isFirst && !hasLeadingPipe) {
          // Only trailing side must be single-space padded.
          if (startsWithSpace) return false;
          if (!endsWithSpace || endsWithTwoSpaces) return false;
          continue;
        }
        if (isLast && !hasTrailingPipe) {
          // Only leading side must be single-space padded.
          if (endsWithSpace) return false;
          if (!startsWithSpace || startsWithTwoSpaces) return false;
          continue;
        }

        // Middle cells (and edge cells when leading/trailing pipes exist) must
        // have exactly one leading and one trailing space.
        if (!startsWithSpace || startsWithTwoSpaces) return false;
        if (!endsWithSpace || endsWithTwoSpaces) return false;
      }

      return true;
    };

    for (let idx = 0; idx + 1 < lines.length; idx++) {
      if (lineIsInFence[idx] || lineIsInFence[idx + 1]) continue;

      const header = lines[idx];
      const sep = lines[idx + 1];

      if (!header.includes("|") || !isTableSeparatorRow(sep)) continue;

      // Collect table lines (header, separator, body rows until blank/non-table).
      const tableLineIdxs: number[] = [idx, idx + 1];
      let rowIdx = idx + 2;
      while (rowIdx < lines.length) {
        if (lineIsInFence[rowIdx]) break;
        const row = lines[rowIdx];
        if (row.trim() === "") break;
        if (!row.includes("|")) break;
        tableLineIdxs.push(rowIdx);
        rowIdx++;
      }

      // Determine which table column style the table best matches.
      const headerPipePositions = pipeVisualPositions(lines[tableLineIdxs[0]]);
      const alignedViolations: number[] = [];
      const compactViolations: number[] = [];
      const tightViolations: number[] = [];

      for (const lineIndex of tableLineIdxs) {
        const row = lines[lineIndex].replace(/[ \t]+$/g, "");

        const rowPipes = pipeVisualPositions(row);
        const alignedOk = rowPipes.length === headerPipePositions.length &&
          rowPipes.every((p, i) => p === headerPipePositions[i]);
        if (!alignedOk) alignedViolations.push(lineIndex);

        if (!rowMatchesCompact(row)) compactViolations.push(lineIndex);
        if (!rowMatchesTight(row)) tightViolations.push(lineIndex);
      }

      const styles = [
        { name: "aligned", violations: alignedViolations },
        { name: "compact", violations: compactViolations },
        { name: "tight", violations: tightViolations },
      ] as const;

      const best = styles.reduce((a, b) => b.violations.length < a.violations.length ? b : a);

      if (best.violations.length > 0) {
        for (const badLineIndex of best.violations) {
          findings.push({
            filePath,
            line: badLineIndex + 1,
            rule: "MD060/table-column-style",
            severity: options.strict ? Severity.ERROR : Severity.WARN,
            message: `Table column style [Table pipe does not align with header for style "${best.name}"]`,
          });
        }
      }

      // Skip ahead to avoid re-detecting the same table on the next line.
      idx = Math.max(idx, rowIdx - 1);
    }
  }

  // MD003: file should end with a newline
  if (!normalized.endsWith("\n")) {
    findings.push({
      filePath,
      line: lines.length,
      rule: "MD003",
      severity: Severity.ERROR,
      message: "File must end with a newline",
    });
  }

  // MD004: fenced code blocks must be closed
  if (inFence) {
    findings.push({
      filePath,
      line: fenceStartLine || 1,
      rule: "MD004",
      severity: Severity.ERROR,
      message: "Unclosed fenced code block",
    });
  }

  return findings;
}

function formatFinding(f: IFinding): string {
  return `${f.filePath}:${f.line} [${f.severity}] ${f.rule} ${f.message}`;
}

function countErrors(findings: IFinding[]): number {
  return findings.filter((f) => f.severity === "error").length;
}

async function main() {
  const { options, paths } = parseArgs(Deno.args);

  const markdownFiles = await collectMarkdownFiles(paths);
  if (markdownFiles.length === 0) {
    console.log("No markdown files found.");
    return;
  }

  let totalFindings: IFinding[] = [];
  let fixedCount = 0;

  for (const filePath of markdownFiles) {
    if (options.verbose) console.log(`Linting ${filePath}`);

    let content = await Deno.readTextFile(filePath);
    let changed = false;

    if (options.fix) {
      // First apply safe fixes
      const safeResult = applySafeFixes(content);
      if (safeResult.changed) {
        content = safeResult.fixed;
        changed = true;
      }

      // Iteratively apply specific fixes based on linting results
      const maxIterations = 5;
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const findings = lintMarkdown(content, filePath, options);
        const fixableFindings = findings.filter((f) =>
          f.rule === "MD032/blanks-around-lists" ||
          f.rule === "MD029/ol-prefix" ||
          f.rule === "MD022/blanks-around-headings" ||
          f.rule === "MD001/heading-increment" ||
          f.rule === "MD025/single-title/single-h1" ||
          f.rule === "MD026/no-trailing-punctuation" ||
          f.rule === "MD031/blanks-around-fences" ||
          f.rule === "MD060/table-column-style" ||
          f.rule === "MD040/fenced-code-language" ||
          f.rule === "MD041/first-line-heading/first-line-h1" ||
          f.rule === "MD004" ||
          f.rule === "MD036/no-emphasis-as-heading" ||
          f.rule === "MD049/emphasis-style" ||
          f.rule === "MD010" ||
          f.rule === "MD011"
        );

        const specificResult = applySpecificFixes(content, fixableFindings);
        if (specificResult.changed) {
          content = specificResult.fixed;
          changed = true;
          // Reapply safe fixes after specific fixes
          const safeResult = applySafeFixes(content);
          if (safeResult.changed) {
            content = safeResult.fixed;
          }
        } else {
          break; // No more changes possible
        }
      }

      if (changed) {
        await Deno.writeTextFile(filePath, content);
        fixedCount++;
      }
    }

    const findings = lintMarkdown(content, filePath, options);
    totalFindings = totalFindings.concat(findings);
  }

  for (const finding of totalFindings) {
    console.log(formatFinding(finding));
  }

  if (options.fix) {
    console.log(`Fixed ${fixedCount} file(s).`);
  }

  const errors = countErrors(totalFindings);
  const warns = totalFindings.length - errors;

  if (totalFindings.length === 0) {
    console.log("Markdown lint: OK");
    return;
  }

  console.log(`Markdown lint: ${errors} error(s), ${warns} warning(s)`);

  if (errors > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
