#!/usr/bin/env -S deno run -A
/**
 * @module CheckDocSectionRefs
 * @path scripts/check_doc_section_refs.ts
 * @description Validates QUOTED `§"Heading Text"` prose citations against the real
 *   headings of their target file — the exact citation form used throughout this
 *   repo to name a canonical section (e.g. `ARCHITECTURE.md §"Packages vs. Services
 *   — Placement Model"`). This closes the gap that let five citations across
 *   `.copilot/skills/package-extraction/SKILL.md` and two `exaix-dev-docs/dev/` files
 *   point at an ARCHITECTURE.md section that had been removed, undetected, until a
 *   documentation refactor happened to notice it by hand.
 *
 *   Usage:
 *     deno run --allow-read --allow-run=git scripts/check_doc_section_refs.ts [root] [--staged]
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path, scripts/check_md_paths.ts]
 * @related-files [scripts/check_md_paths.ts, tests/scripts/check_doc_section_refs_test.ts]
 */

/*
 * Scope, deliberately narrow: ONLY the quoted form `§"..."` is validated, whether
 * cross-file (`File.md §"Heading"`) or self-referencing (`§"Heading"`, no adjacent
 * filename). Unquoted citations — `§2`, `§F`, or `ARCHITECTURE.md § AI Provider
 * Architecture for the full list...` — are intentionally left unvalidated:
 *
 *   - Numbered/lettered forms (`§2`, `§6.2`, `§F`, `§3D`) name an author's own
 *     informal numbering scheme, not necessarily a literal heading; validating them
 *     would need per-document numbering-scheme knowledge this script doesn't have.
 *   - Unquoted mid-sentence citations have no reliable closing boundary: "ARCHITECTURE.md
 *     § AI Provider Architecture for the full provider list and registration paths"
 *     — where does the heading name end and the surrounding prose begin? A greedy
 *     match risks capturing prose as if it were the title and reporting a false
 *     violation. The quote marks in `§"..."` are the one unambiguous signal that the
 *     author intends an exact, checkable title, so that is the form this script
 *     enforces — and the form worth teaching authors to prefer for anything that
 *     should stay correct as sections get renamed or removed.
 *
 * A citation whose captured filename does NOT resolve to a real file is reported
 * with `headingFound: false` (the file itself is missing — a different failure mode
 * than "file exists, heading doesn't", surfaced distinctly rather than silently
 * folded into a generic "not found").
 */

import { walk } from "@std/fs";
import { dirname, isAbsolute, relative, resolve } from "@std/path";
import { extractHeadings, FenceTracker, IGNORE_DIRS, type IHeading, stagedMarkdownFiles } from "./check_md_paths.ts";

/** A quoted §-citation whose title does not match any heading in its target file. */
export interface ISectionRefViolation {
  /** Repo-relative path of the markdown file containing the citation. */
  file: string;
  /** 1-based line number of the citation. */
  line: number;
  /** The exact matched citation text, e.g. `ARCHITECTURE.md §"Foo"`. */
  reference: string;
  /** Repo-relative path of the file the citation names (== `file` for self-references). */
  targetFile: string;
  /** The quoted title exactly as written. */
  citedTitle: string;
  /** False when `targetFile` itself does not resolve (a distinct failure mode). */
  headingFound: boolean;
}

export interface ISectionRefResult {
  ok: boolean;
  violations: ISectionRefViolation[];
}

export interface ICheckOptions {
  /** Restrict violations to this set of repo-relative markdown files (the pre-commit
   * ratchet): only staged/changed docs block, not pre-existing drift elsewhere. */
  onlyFiles?: Set<string>;
}

/** Markdown files that are not documentation cross-references (mirrors check_md_paths.ts). */
function isNonDocMarkdown(relPath: string): boolean {
  return (
    relPath.includes("scenario_framework/fixtures/") ||
    relPath.includes("/fixtures/requests/") ||
    relPath.includes("Workspace/Requests/")
  );
}

const CITATION_RE = /(?:`?([A-Za-z0-9_./-]+\.md)`?\s+)?§\s*"([^"\n]{2,150})"/g;

/** Strip markdown emphasis/code markers and a leading ordinal ("7. ", "A) ") from a
 * heading or citation title, then case-fold and collapse whitespace for comparison. */
function normalizeHeadingText(text: string): string {
  let t = text;
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/_([^_]+)_/g, "$1");
  // Citations name a section by title; the heading's own enumerated-list ordinal
  // ("7. ", "A) ") is presentation, not part of the title.
  t = t.replace(/^\s*(?:\d+|[A-Za-z])[.)]\s+/, "");
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Scan all markdown files under `root` for quoted §-citations that don't resolve. */
export async function checkDocSectionRefs(root: string, options: ICheckOptions = {}): Promise<ISectionRefResult> {
  const absRoot = resolve(root);
  const violations: ISectionRefViolation[] = [];
  const headingsCache = new Map<string, IHeading[]>();

  for await (
    const entry of walk(absRoot, {
      exts: [".md"],
      includeDirs: false,
      followSymlinks: false,
      skip: Object.keys(IGNORE_DIRS).map((d) => new RegExp(`(^|/)${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`)),
    })
  ) {
    const rel = relative(absRoot, entry.path).replaceAll("\\", "/");
    if (isNonDocMarkdown(rel)) continue;
    if (options.onlyFiles && !options.onlyFiles.has(rel)) continue;

    const text = await Deno.readTextFile(entry.path);
    const lines = text.split("\n");
    const fence = new FenceTracker();

    // Soft-wrapped prose commonly splits a citation across lines, e.g.
    // "...lives in `ARCHITECTURE.md`\n§"Packages vs. Services — Placement Model"."
    // Join consecutive non-blank, non-fenced lines into one logical paragraph before
    // matching, so word-wrap never hides a citation from the filename that precedes
    // it. Violations are reported at the paragraph's start line.
    let paragraph: string[] = [];
    let paragraphStartLine = 0;

    const scanParagraph = async () => {
      if (paragraph.length === 0) return;
      const joined = paragraph.join(" ");
      paragraph = [];

      for (const m of joined.matchAll(CITATION_RE)) {
        const filePart = m[1];
        const citedTitle = m[2].trim();

        let targetAbs: string;
        let targetRel: string;
        if (filePart) {
          const candidates = isAbsolute(filePart)
            ? [filePart]
            : [resolve(dirname(entry.path), filePart), resolve(absRoot, filePart)];
          const resolved = candidates.find((c) => {
            try {
              Deno.statSync(c);
              return true;
            } catch {
              return false;
            }
          });
          if (!resolved) {
            violations.push({
              file: rel,
              line: paragraphStartLine,
              reference: m[0],
              targetFile: filePart,
              citedTitle,
              headingFound: false,
            });
            continue;
          }
          targetAbs = resolved;
          targetRel = relative(absRoot, resolved).replaceAll("\\", "/");
        } else {
          targetAbs = entry.path;
          targetRel = rel;
        }

        let headings = headingsCache.get(targetAbs);
        if (!headings) {
          try {
            headings = extractHeadings(await Deno.readTextFile(targetAbs));
          } catch {
            headings = [];
          }
          headingsCache.set(targetAbs, headings);
        }

        const wantNorm = normalizeHeadingText(citedTitle);
        const found = headings.some((h) => normalizeHeadingText(h.text) === wantNorm);
        if (!found) {
          violations.push({
            file: rel,
            line: paragraphStartLine,
            reference: m[0],
            targetFile: targetRel,
            citedTitle,
            headingFound: true,
          });
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence.update(line)) {
        await scanParagraph();
        continue;
      }
      if (line.trim() === "") {
        await scanParagraph();
        continue;
      }
      if (paragraph.length === 0) paragraphStartLine = i + 1;
      // Strip a leading blockquote marker ("> ") and surrounding indentation before
      // joining — otherwise ">" from a wrapped blockquote line, or the extra indent
      // of a wrapped list-item continuation, becomes stray characters INSIDE the
      // joined citation text (e.g. a `> by Edition"` continuation line would leak a
      // literal "> " into the matched title).
      paragraph.push(line.replace(/^\s*>\s?/, "").trim());
    }
    await scanParagraph();
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { ok: violations.length === 0, violations };
}

function reportViolations(violations: ISectionRefViolation[]): void {
  console.error(`❌ ${violations.length} quoted §-citation(s) that don't match a real heading:`);
  for (const v of violations) {
    const detail = v.headingFound
      ? `no "${v.citedTitle}" heading in ${v.targetFile === v.file ? "this file" : v.targetFile}`
      : `target file "${v.targetFile}" does not resolve`;
    console.error(`  ${v.file}:${v.line}  ${v.reference}  (${detail})`);
  }
}

if (import.meta.main) {
  const args = [...Deno.args];
  const staged = args.includes("--staged");
  const root = args.find((a) => !a.startsWith("--")) ?? ".";

  const onlyFiles = staged ? await stagedMarkdownFiles(root) : undefined;
  if (staged && onlyFiles!.size === 0) {
    console.log("✅ Doc section-reference check: no staged markdown files.");
    Deno.exit(0);
  }

  const result = await checkDocSectionRefs(root, { onlyFiles });

  if (result.ok) {
    console.log('✅ Doc section-reference check: every quoted §"..." citation matches a real heading.');
    Deno.exit(0);
  }

  reportViolations(result.violations);
  Deno.exit(1);
}
