#!/usr/bin/env -S deno run -A
/**
 * @module CheckSkillEphemera
 * @path scripts/check_skill_ephemera.ts
 *
 * Usage:
 *   deno task check:skill-ephemera   # the registered form
 *   deno run -A scripts/check_skill_ephemera.ts  # direct; exits 1 on findings
 *
 * @description Flags "leaked ephemeral detail" in generic skill guidance: a dated
 *   incident-recounting sentence (a `YYYY-MM-DD` date co-occurring with a process/incident
 *   verb — "2026-08-04 post-gap analysis found", "audit (2026-08-15)", "landed by Phase
 *   168") inside a `.copilot/skills/<name>/SKILL.md`. A general skill every phase re-reads
 *   must carry rules that are true across phases, not a dated recount of one past phase;
 *   phase/domain-specific narrative belongs in the owning domain doc or the phase doc's own
 *   Retrospective (2026-08-24 self-improvement retro finding). The check lets through:
 *   - frontmatter and fenced code blocks (commands/examples may legitimately show a date),
 *   - a date without a process/incident verb (a stable citation like a doc filename),
 *   - "Examples" prose that is deliberately illustrative.
 *
 *   Scope deliberately narrow: date+verb co-occurrence in skill prose only. A repo-wide
 *   prose linter would over-flag the planning corpus, where dated entries are legitimate.
 *   Per standing project instruction, new tasks are not attached to CI jobs or pre-commit
 *   gates — this runs as `deno task check:skill-ephemera`.
 * @architectural-layer Script
 * @dependencies []
 * @related-files [tests/scripts/check_skill_ephemera_test.ts, .copilot/skills/self-improvement/SKILL.md]
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";

/** A flagged line of ephemeral narrative in a skill doc. */
export interface IEphemeraFinding {
  /** Repo-relative path of the skill doc. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The offending line, trimmed. */
  text: string;
}

const SKILLS_DIR = ".copilot/skills";

/** A `YYYY-MM-DD` calendar date. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Process/incident verbs that frame a dated past-event recount rather than a rule. */
const INCIDENT_VERB_RE =
  /\b(audit|audited|found|discover|discovered|hit|landed|land(e|s|ed)?\s+by|finalized|surfaced|recorded|learned|saw|this session|regression|post-gap\s+analysis)\b/i;

/**
 * Return the prose lines of a SKILL.md body: the frontmatter is stripped, and lines inside
 * an inner CODE fence (bash/typescript/yaml/toml/… examples) are exempt. The outer
 * wrapper that frames the whole skill body is PROSE for this check —
 * it carries the guidance narrative, which is exactly what must be scanned.
 */
export function skillProseLines(skillMarkdown: string): string[] {
  const lines = skillMarkdown.split("\n");
  const out: string[] = [];
  let inFrontmatter = false;
  let fenceKind = "";
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!inFrontmatter && !fenceKind && /^---\s*$/.test(line) && out.length === 0) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (/^---\s*$/.test(line)) {
        inFrontmatter = false;
        continue;
      }
      continue; // frontmatter is exempt
    }
    if (fenceKind) {
      if (/^```/.test(line)) {
        fenceKind = "";
      }
      continue; // inside a code fence — exempt
    }
    const openMatch = /^```([a-z]*)/.exec(line);
    if (openMatch) {
      // Only non-`text` fences are CODE (exempt). The `text` fence is the skill-body prose.
      if (openMatch[1] !== "text") {
        fenceKind = openMatch[1];
      }
      continue;
    }
    out.push(line);
  }
  return out;
}

/** True when a prose line looks like a dated incident recount rather than a plain rule. */
export function isEphemeralNarrative(line: string): boolean {
  return DATE_RE.test(line) && INCIDENT_VERB_RE.test(line);
}

/** Scan every `.copilot/skills/<name>/SKILL.md` and collect dated-narrative lines. */
export async function scanSkills(root = "."): Promise<IEphemeraFinding[]> {
  const findings: IEphemeraFinding[] = [];
  for await (
    const entry of walk(root, {
      includeDirs: false,
      exts: [".md"],
      skip: [/node_modules/, /\.git/],
    })
  ) {
    if (!entry.path.includes(`${SKILLS_DIR}/`) || !entry.name.endsWith("SKILL.md")) continue;
    const text = Deno.readTextFileSync(entry.path);
    const prose = skillProseLines(text);
    for (let i = 0; i < prose.length; i++) {
      if (isEphemeralNarrative(prose[i])) {
        findings.push({
          file: relative(root, entry.path),
          line: i + 1,
          text: prose[i].trim(),
        });
      }
    }
  }
  return findings;
}

if (import.meta.main) {
  const findings = await scanSkills();
  if (findings.length > 0) {
    console.error(
      "❌ Dated incident narrative leaked into generic skill guidance (route to the domain doc or phase-doc Retrospective instead):",
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.text}`);
    }
    console.error(`\nFound ${findings.length} violation(s).`);
    Deno.exit(1);
  }
  console.log("✅ No dated incident narrative in skill guidance.");
}
