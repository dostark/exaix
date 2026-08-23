#!/usr/bin/env -S deno run -A

/**
 * @module CheckReachabilityLedger
 * @path scripts/check_reachability_ledger.ts
 *
 * Usage:
 *   deno run -A scripts/check_reachability_ledger.ts [doc-glob]
 *   [doc-glob]  Glob for phase plan docs (default: exaix-dev-docs/planning/phase-*.md).
 *
 * @description Mechanizes the repo-wide "does this ✅ ledger row have a real call-site"
 *   grep audit that phase-158's 2026-08-04 post-gap analysis had to do by hand: it found
 *   six Reachability Ledger rows marked ✅ closed, naming specific functions
 *   (`computePairedComparison`, `evaluateValidityGate`, nine Step 4-6 reporting modules,
 *   etc.) as the production call-site that produced published live-run numbers — and a
 *   repo-wide grep, including full git history, showed none of those functions were ever
 *   called by anything outside their own unit tests. This script parses every phase plan
 *   doc's "Reachability Ledger" table(s), and for each row marked ✅, extracts the
 *   code-identifier-looking tokens from its "Production call-site" cell and verifies each
 *   one has a real reference outside its own definition file and outside test files.
 *   Advisory only (like `check:god-objects`) — the free-text heuristic can both miss real
 *   symbols (e.g. wired only via dynamic dispatch or a string-keyed registry) and surface
 *   ones worth a human's second look, so it is not wired into `scripts/ci.ts` or any
 *   pre-commit gate. A finding here is exactly the class of gap G2 in the `next-steps` and
 *   `post-gap-analysis` skills says must never be marked ✅ without a verifiable call-site.
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path]
 * @related-files [tests/scripts/check_reachability_ledger_test.ts, scripts/check_step_manifests.ts, scripts/check_blueprint_integrity.ts, .claude/skills/next-steps/SKILL.md, .claude/skills/post-gap-analysis/SKILL.md]
 */

import { expandGlob, walk } from "@std/fs";
import { relative } from "@std/path";

export interface IFileRecord {
  path: string;
  content: string;
}

export interface IReachabilityLedgerRow {
  docPath: string;
  symbolLabel: string;
  addedIn: string;
  wiringStep: string;
  callSiteText: string;
  status: string;
}

export interface IUnverifiedLedgerSymbol {
  docPath: string;
  ledgerRowSymbol: string;
  candidateIdentifier: string;
  reason: string;
}

/** A Reachability Ledger table row that does not match the canonical 5-column shape
 *  (`Symbol | Added in | Wiring step | Production call-site | Status`). Reported by
 *  `detectLedgerShapeWarnings` so a malformed table is surfaced instead of silently
 *  skipped by `parseReachabilityLedgerRows`. */
export interface ILedgerShapeWarning {
  docPath: string;
  line: number;
  cellCount: number;
}

const LEDGER_HEADING_PATTERN = /^#{1,3}\s+.*Reachability Ledger.*$/;
const TABLE_HEADER_PATTERN = /^\|.*\bSymbol\b.*\|$/;
const TABLE_SEPARATOR_PATTERN = /^\|[\s:|-]+\|$/;
const TABLE_ROW_PATTERN = /^\|.*\|$/;
const CLOSED_STATUS = "✅";
const TEST_FILE_PATTERN = /_test\.ts$/;

/** A ledger row's Status cell counts as closed when it starts with the checkmark, not only
 *  when it is the bare checkmark alone — the repo's own established convention (`#next-steps`
 *  skill's own "Do" list) labels closed rows `✅ WIRED`/`✅ CORE <detail>`, and an exact-equality
 *  check silently treats every such row as still-open, auditing zero of them (Phase 154
 *  self-improvement-retro finding, discovered running `check:reachability-ledger` for real
 *  during the phase's own Phase Completion Gate — confirmed also affecting phase-111 and
 *  phase-121's own ledgers, not specific to one doc). */
export function isClosedStatus(status: string): boolean {
  return status.trim().startsWith(CLOSED_STATUS);
}

/** Splits a markdown table row into trimmed cells, dropping the leading/trailing empties
 *  a `| a | b |`-style split produces. */
function splitTableRow(line: string): string[] {
  const parts = line.split("|");
  return parts.slice(1, -1).map((cell) => cell.trim());
}

/**
 * Parses every "Reachability Ledger" table in a phase plan doc into rows. A doc may carry
 * more than one such table (e.g. a frozen historical snapshot alongside the live one) —
 * every table is parsed; callers only act on ✅ rows, and a frozen snapshot's rows are
 * conventionally left ⏳, so this does not double-count a closure.
 */
export function parseReachabilityLedgerRows(content: string, docPath: string): IReachabilityLedgerRow[] {
  const lines = content.split("\n");
  const rows: IReachabilityLedgerRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!LEDGER_HEADING_PATTERN.test(lines[i])) continue;

    // Scan forward for the table header, then the separator, then data rows.
    let j = i + 1;
    while (j < lines.length && !TABLE_HEADER_PATTERN.test(lines[j])) {
      if (LEDGER_HEADING_PATTERN.test(lines[j])) break; // no table under this heading
      j++;
    }
    if (j >= lines.length || !TABLE_HEADER_PATTERN.test(lines[j])) continue;
    j++; // past header
    if (j >= lines.length || !TABLE_SEPARATOR_PATTERN.test(lines[j])) continue;
    j++; // past separator

    while (j < lines.length && TABLE_ROW_PATTERN.test(lines[j])) {
      const cells = splitTableRow(lines[j]);
      if (cells.length >= 5) {
        rows.push({
          docPath,
          symbolLabel: cells[0],
          addedIn: cells[1],
          wiringStep: cells[2],
          callSiteText: cells[3],
          status: cells[4],
        });
      }
      j++;
    }
  }

  return rows;
}

/**
 * Shape-check every Reachability Ledger table in a doc against the canonical 5-column
 * contract (`Symbol | Added in | Wiring step | Production call-site | Status`). A table
 * whose data rows do not parse to 5 cells is silently skipped by `parseReachabilityLedgerRows`
 * (phase-165's ledger was authored 3-column and the audit reported "0 closed rows" with no
 * warning), so this returns the offending doc/line to surface the format drift instead.
 */
export function detectLedgerShapeWarnings(content: string, docPath: string): ILedgerShapeWarning[] {
  const lines = content.split("\n");
  const warnings: ILedgerShapeWarning[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!LEDGER_HEADING_PATTERN.test(lines[i])) continue;

    let j = i + 1;
    while (j < lines.length && !TABLE_HEADER_PATTERN.test(lines[j])) {
      if (LEDGER_HEADING_PATTERN.test(lines[j])) break;
      j++;
    }
    if (j >= lines.length || !TABLE_HEADER_PATTERN.test(lines[j])) continue;
    j++;
    if (j >= lines.length || !TABLE_SEPARATOR_PATTERN.test(lines[j])) continue;
    j++;

    let sawRow = false;
    while (j < lines.length && TABLE_ROW_PATTERN.test(lines[j])) {
      const cells = splitTableRow(lines[j]);
      if (cells.length >= 1) sawRow = true;
      if (cells.length > 0 && cells.length !== 5) {
        warnings.push({ docPath, line: j + 1, cellCount: cells.length });
      }
      j++;
    }
    if (!sawRow) {
      // Heading present but no parseable data rows — the table shape is not the
      // canonical 5-column form the audit depends on (or the ledger is empty).
      warnings.push({ docPath, line: j + 1, cellCount: 0 });
    }
  }

  return warnings;
}

/** camelCase, PascalCase, or CONSTANT_CASE (underscore-separated) identifier shapes —
 *  deliberately excludes kebab-case ledger labels and plain-lowercase or single-word
 *  ALL-CAPS prose, which cannot be real TypeScript export identifiers. */
const CANDIDATE_PATTERN = /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/** Extracts code-identifier-looking tokens from a ledger cell's free text. Backticks and
 *  other markdown punctuation are not special-cased — the identifier regex only matches
 *  the word shape, so surrounding punctuation is naturally excluded. */
export function extractCandidateSymbols(cellText: string): string[] {
  const found = new Set<string>();
  for (const match of cellText.matchAll(CANDIDATE_PATTERN)) {
    found.add(match[0]);
  }
  return [...found];
}

/** snake_case.ts-shaped filename mentions — a ledger row's "Production call-site" cell
 *  often names the module doing the work (e.g. `skill_value_plan.ts`) rather than a
 *  specific function, especially for `[live, operator-run]` closures. */
const FILENAME_CANDIDATE_PATTERN = /\b[a-z][a-z0-9_]*\.ts\b/g;

/** Extracts filename-shaped tokens from a ledger cell's free text. */
export function extractCandidateFilenames(cellText: string): string[] {
  const found = new Set<string>();
  for (const match of cellText.matchAll(FILENAME_CANDIDATE_PATTERN)) {
    found.add(match[0]);
  }
  return [...found];
}

const EXPORT_DEFINITION_KEYWORDS = "function|const|class|interface|type|enum|abstract class";

/**
 * Strips `/* ... *\/` block comments (including JSDoc module headers) and `//` line
 * comments so a symbol name merely *mentioned* in a comment — e.g. this very script's own
 * `@description` naming the functions it audits — never counts as a usage or a
 * definition. The `//` strip requires the preceding character not be `:`, a crude but
 * sufficient guard against truncating `https://` URLs inside string literals.
 */
function stripComments(content: string): string {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Files whose content declares `export (function|const|class|interface|type|enum)
 *  IDENTIFIER` — i.e. where the identifier is genuinely defined, not merely mentioned in
 *  a comment. */
export function findExportDefinitionFiles(identifier: string, files: IFileRecord[]): string[] {
  const pattern = new RegExp(`export\\s+(?:async\\s+)?(?:${EXPORT_DEFINITION_KEYWORDS})\\s+${identifier}\\b`);
  return files.filter((f) => pattern.test(stripComments(f.content))).map((f) => f.path);
}

/** Files referencing `identifier` as a whole word outside comments, excluding the files
 *  it is defined in. Callers are expected to have already excluded test files. */
export function findUsageFiles(
  identifier: string,
  files: IFileRecord[],
  excludeFiles: ReadonlySet<string>,
): string[] {
  const pattern = new RegExp(`\\b${identifier}\\b`);
  return files
    .filter((f) => !excludeFiles.has(f.path))
    .filter((f) => pattern.test(stripComments(f.content)))
    .map((f) => f.path);
}

/** Files whose path's basename equals `filename` — the file the ledger cell names. */
export function findFilesByBasename(filename: string, files: IFileRecord[]): string[] {
  return files.filter((f) => f.path === filename || f.path.endsWith(`/${filename}`)).map((f) => f.path);
}

/** Files (outside comments, excluding `excludeFiles`) whose content mentions `filename` —
 *  a plain substring check, since `.` breaks `\b` word-boundary matching and a Deno
 *  import always spells the extension out (`from "./skill_value_plan.ts"`). */
export function findFilenameReferences(
  filename: string,
  files: IFileRecord[],
  excludeFiles: ReadonlySet<string>,
): string[] {
  return files
    .filter((f) => !excludeFiles.has(f.path))
    .filter((f) => stripComments(f.content).includes(filename))
    .map((f) => f.path);
}

/** True when any of the given files' (comment-stripped) content declares an
 *  `import.meta.main` entrypoint guard — such a file is invoked directly via `deno run`,
 *  not imported by another module, so "never imported elsewhere" is not a meaningful
 *  reachability signal for it. */
function isEntrypointScript(definitionFiles: string[], files: IFileRecord[]): boolean {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  return definitionFiles.some((path) => {
    const content = byPath.get(path);
    return content !== undefined && stripComments(content).includes("import.meta.main");
  });
}

/**
 * True when `identifier` is both defined in, and referenced a second time within, a file
 * that is itself an `import.meta.main` entrypoint — the common shape of every script this
 * repo already ships (`check_blueprint_integrity.ts`, `check_artefact_decision_coverage.ts`,
 * `run_value_comparison_report.ts`): a small exported helper called only from that same
 * file's entrypoint block. A single occurrence is just the `export` declaration; a second
 * occurrence is a real call from the file's own reachable entrypoint, even though no
 * _other_ file ever imports the symbol. Known imprecision, same class as the rest of this
 * tool: the second "occurrence" is a raw text match, so an identifier that happens to
 * appear inside a string literal (e.g. a log message) would also count — narrow and
 * unlikely, but a false negative, not a false positive, so it under- rather than
 * over-reports.
 */
function isCalledFromOwnEntrypoint(identifier: string, definitionFiles: string[], files: IFileRecord[]): boolean {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const pattern = new RegExp(`\\b${identifier}\\b`, "g");
  return definitionFiles.some((path) => {
    const content = byPath.get(path);
    if (content === undefined || !stripComments(content).includes("import.meta.main")) return false;
    const occurrences = stripComments(content).match(pattern);
    return (occurrences?.length ?? 0) >= 2;
  });
}

/**
 * Audits every ✅ row for candidate identifiers with no verifiable call-site. A candidate
 * that resolves to no `export` declaration anywhere is skipped, not flagged — it is most
 * likely a ledger label, a commit SHA, or prose, not a real code symbol this check can
 * verify. Test files never count as a usage site, regardless of whether `files` already
 * excludes them — filtered here so this function's guarantee does not depend on caller
 * discipline (`readTsFiles` also excludes them, for I/O efficiency, not correctness).
 */
export function auditLedgerRows(rows: IReachabilityLedgerRow[], files: IFileRecord[]): IUnverifiedLedgerSymbol[] {
  const findings: IUnverifiedLedgerSymbol[] = [];
  const productionFiles = files.filter((f) => !TEST_FILE_PATTERN.test(f.path));

  for (const row of rows) {
    if (!isClosedStatus(row.status)) continue;

    for (const candidate of extractCandidateSymbols(row.callSiteText)) {
      const definitionFiles = findExportDefinitionFiles(candidate, productionFiles);
      if (definitionFiles.length === 0) continue; // not a verifiable code symbol
      if (isCalledFromOwnEntrypoint(candidate, definitionFiles, productionFiles)) continue;

      const usageFiles = findUsageFiles(candidate, productionFiles, new Set(definitionFiles));
      if (usageFiles.length === 0) {
        findings.push({
          docPath: row.docPath,
          ledgerRowSymbol: row.symbolLabel,
          candidateIdentifier: candidate,
          reason: `"${candidate}" is exported from ${definitionFiles.join(", ")} but has no reference ` +
            `outside that file and outside test files`,
        });
      }
    }

    for (const filename of extractCandidateFilenames(row.callSiteText)) {
      const definitionFiles = findFilesByBasename(filename, productionFiles);
      if (definitionFiles.length === 0) continue; // not a file that actually exists
      if (isEntrypointScript(definitionFiles, productionFiles)) continue; // invoked directly, not imported

      const referencingFiles = findFilenameReferences(filename, productionFiles, new Set(definitionFiles));
      if (referencingFiles.length === 0) {
        findings.push({
          docPath: row.docPath,
          ledgerRowSymbol: row.symbolLabel,
          candidateIdentifier: filename,
          reason: `"${filename}" exists at ${definitionFiles.join(", ")} but is never imported or ` +
            `referenced by another non-test file`,
        });
      }
    }
  }

  return findings;
}

/** Reads every non-test `.ts` file under the given roots (that exist). */
export async function readTsFiles(roots: string[]): Promise<IFileRecord[]> {
  const files: IFileRecord[] = [];
  for (const root of roots) {
    try {
      await Deno.stat(root);
    } catch {
      continue;
    }
    for await (const entry of walk(root, { exts: [".ts"], followSymlinks: false })) {
      const path = relative(".", entry.path);
      if (TEST_FILE_PATTERN.test(path)) continue;
      files.push({ path, content: await Deno.readTextFile(entry.path) });
    }
  }
  return files;
}

/** Reads every doc matching `globPattern`. */
export async function readPhaseDocs(globPattern: string): Promise<IFileRecord[]> {
  const docs: IFileRecord[] = [];
  for await (const entry of expandGlob(globPattern)) {
    if (!entry.isFile) continue;
    const path = relative(".", entry.path);
    docs.push({ path, content: await Deno.readTextFile(entry.path) });
  }
  return docs;
}

const DEFAULT_DOC_GLOB = "exaix-dev-docs/planning/phase-*.md";
const CODE_ROOTS = ["packages", "packages-team", "apps", "scripts", "tests"];

if (import.meta.main) {
  const docGlob = Deno.args[0] ?? DEFAULT_DOC_GLOB;
  const [docs, files] = await Promise.all([readPhaseDocs(docGlob), readTsFiles(CODE_ROOTS)]);

  const allRows = docs.flatMap((doc) => parseReachabilityLedgerRows(doc.content, doc.path));
  const shapeWarnings = docs.flatMap((doc) => detectLedgerShapeWarnings(doc.content, doc.path));
  const closedRows = allRows.filter((r) => isClosedStatus(r.status));
  const findings = auditLedgerRows(allRows, files);

  for (const w of shapeWarnings) {
    console.warn(
      `⚠️  [${w.docPath}:${w.line}] Reachability Ledger row has ${w.cellCount} column(s), ` +
        `expected 5 (Symbol | Added in | Wiring step | Production call-site | Status) — ` +
        `this table is skipped by the audit; fix the column shape.`,
    );
  }

  if (findings.length === 0) {
    console.log(
      `✅ Reachability Ledger audit: ${closedRows.length} closed row(s) across ${docs.length} doc(s), ` +
        `no unverifiable call-sites found (${files.length} non-test .ts files scanned).`,
    );
    Deno.exit(0);
  }

  console.error(
    `\n⚠️  Reachability Ledger audit: ${findings.length} candidate finding(s) across ` +
      `${new Set(findings.map((f) => f.docPath)).size} doc(s). This is advisory — verify by hand before ` +
      `treating a row as unclosed. Known false-positive sources: dynamic-dispatch/registry-based wiring the ` +
      `heuristic cannot see, and an entrypoint script that omits the \`import.meta.main\` guard (recognized as ` +
      `invoked-not-imported only when that guard is present).\n`,
  );
  for (const f of findings) {
    console.error(`  [${f.docPath}] row ${f.ledgerRowSymbol}: ${f.reason}`);
  }
  Deno.exit(1);
}
