#!/usr/bin/env -S deno run -A
/**
 * @module CheckSkillDuplication
 * @path scripts/check_skill_duplication.ts
 *
 * Usage:
 *   deno task check:skill-duplication            # the registered form (whole repo)
 *   deno run -A scripts/check_skill_duplication.ts --policy <path> --repo-root <root>
 *   deno run -A scripts/check_skill_duplication.ts --policy <path> --skills-dir <dir>
 *
 * @description Authoring gate for duplicated instruction prose across the skill corpora
 *   (`Blueprints/Skills` and `.copilot/skills`). A canonical rule block repeated verbatim
 *   into N skills is loaded as N copies of the same text whenever those skills co-render in
 *   one prompt (EXAIX-04: do not repeat information already delivered), and it inflates every
 *   request's loaded skill context. The checker extracts frontmatter-stripped, fence-removed
 *   body prose, normalizes each line, and flags any normalized sentence present in two or
 *   more distinct skill files unless a reviewed policy allowlist entry documents why that
 *   exact text is intentionally shared.
 *   Exit: `0` clean, `1` confirmed duplication, `2` malformed/missing policy or input error.
 * @architectural-layer Script
 * @dependencies [@std/path]
 * @related-files [
 *   "scripts/config/skill_duplication_policy.json",
 *   "tests/scripts/check_skill_duplication_test.ts"
 * ]
 */

import { join, relative } from "@std/path";

/** One reviewed exception: an intentionally-shared exact prose line. */
export interface ISkillDuplicationAllowlistEntry {
  text: string;
  reason: string;
}

/** Script-local policy schema: versioned allowlist of documented shared lines. */
export interface ISkillDuplicationPolicy {
  version: string;
  allowlist: ISkillDuplicationAllowlistEntry[];
}

/** A confirmed duplication: one normalized prose line spanning two or more files. */
export interface ISkillDuplicationFinding {
  text: string;
  files: string[];
}

/** Minimum normalized length below which a line is too trivial to count as duplication. */
const MIN_NORMALIZED_LENGTH = 30;

/** Reads and validates the policy file; throws a descriptive Error when absent/malformed. */
export function loadDuplicationPolicy(policyPath: string): ISkillDuplicationPolicy {
  let raw: string;
  try {
    raw = Deno.readTextFileSync(policyPath);
  } catch {
    throw new Error(`Skill duplication policy not found at ${policyPath}`);
  }
  let parsed: ISkillDuplicationPolicy;
  try {
    parsed = JSON.parse(raw) as ISkillDuplicationPolicy;
  } catch (e) {
    throw new Error(`Skill duplication policy is malformed JSON at ${policyPath}: ${e}`);
  }
  if (parsed.version !== "1" || !Array.isArray(parsed.allowlist)) {
    throw new Error(`Skill duplication policy at ${policyPath} must be schema version "1" with an allowlist array`);
  }
  return parsed;
}

/** Strips YAML frontmatter and the trailing `exaix:` envelope, removes fenced code, and
 *  returns non-empty body prose lines; pure markdown cross-reference bullets are skipped. */
export function extractProseLines(content: string): string[] {
  const withoutFrontmatter = content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/\n---\nexaix:[\s\S]*$/, "");
  const withoutFences = withoutFrontmatter.replace(/```[\s\S]*?```/g, " ");
  return withoutFences
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^[-*]?\s*\[[^\]]+\]\(/.test(line));
}

/** Normalizes a prose line for cross-file comparison: lowercase, alphanumerics+space only. */
export function normalizeProseLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Discovers skill files in both corpora, returning repo-root-relative slash paths.
 *  Blueprints skills live flat in `Blueprints/Skills`; `.copilot` skills live one level
 *  deeper (`./copilot/skills/<skill>/SKILL.md`), so the walker recurses those subdirs. */
export function discoverSkillFiles(repoRoot: string): string[] {
  const result: string[] = [];
  const add = (abs: string): void => {
    result.push(relative(repoRoot, abs).split("\\").join("/"));
  };

  const blueprintsDir = join(repoRoot, "Blueprints", "Skills");
  try {
    for (const entry of Deno.readDirSync(blueprintsDir)) {
      if (entry.isFile && entry.name.endsWith(".skill.md")) add(join(blueprintsDir, entry.name));
    }
  } catch {
    // Absent in some checkouts; not a failure.
  }

  const copilotDir = join(repoRoot, ".copilot", "skills");
  try {
    for (const entry of Deno.readDirSync(copilotDir)) {
      if (!entry.isDirectory) continue;
      const skillFile = join(copilotDir, entry.name, "SKILL.md");
      try {
        if (Deno.statSync(skillFile).isFile) add(skillFile);
      } catch {
        // Not every directory carries a canonical SKILL.md; skip.
      }
    }
  } catch {
    // Absent corpus is skipped, not an error.
  }
  return result.sort();
}

/** Runs the check over a skills dir; returns findings (empty = clean). */
export function runSkillDuplicationCheck(
  options: { skillsDir: string; policyPath: string },
): ISkillDuplicationFinding[] {
  const policy = loadDuplicationPolicy(options.policyPath);
  const allowlisted = new Set(policy.allowlist.map((e) => e.text));

  const byLine = new Map<string, string[]>();
  for (const entry of Deno.readDirSync(options.skillsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".skill.md")) continue;
    const path = join(options.skillsDir, entry.name);
    const content = Deno.readTextFileSync(path);
    for (const line of extractProseLines(content)) {
      const normalized = normalizeProseLine(line);
      if (normalized.length < MIN_NORMALIZED_LENGTH) continue;
      if (allowlisted.has(normalized)) continue;
      const files = byLine.get(normalized) ?? [];
      if (!files.includes(path)) files.push(path);
      byLine.set(normalized, files);
    }
  }
  return [...byLine.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([text, files]) => ({ text, files }));
}

/** Runs the check over a whole repo (both corpora); returns findings (empty = clean). */
export function runRepoSkillDuplicationCheck(
  options: { repoRoot: string; policyPath: string },
): ISkillDuplicationFinding[] {
  const policy = loadDuplicationPolicy(options.policyPath);
  const allowlisted = new Set(policy.allowlist.map((e) => e.text));

  const byLine = new Map<string, string[]>();
  for (const relPath of discoverSkillFiles(options.repoRoot)) {
    const abs = join(options.repoRoot, relPath);
    const content = Deno.readTextFileSync(abs);
    for (const line of extractProseLines(content)) {
      const normalized = normalizeProseLine(line);
      if (normalized.length < MIN_NORMALIZED_LENGTH) continue;
      if (allowlisted.has(normalized)) continue;
      const files = byLine.get(normalized) ?? [];
      if (!files.includes(relPath)) files.push(relPath);
      byLine.set(normalized, files);
    }
  }
  return [...byLine.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([text, files]) => ({ text, files }));
}

function main(): void {
  const args = Deno.args;
  const repoRootIdx = args.indexOf("--repo-root");
  const policyIdx = args.indexOf("--policy");
  const skillsDirIdx = args.indexOf("--skills-dir");

  const repoRoot = repoRootIdx !== -1 ? args[repoRootIdx + 1] : undefined;
  const policyPath = policyIdx !== -1 ? args[policyIdx + 1] : undefined;
  const skillsDir = skillsDirIdx !== -1 ? args[skillsDirIdx + 1] : undefined;

  if (!policyPath) {
    console.error("Usage: check_skill_duplication.ts --policy <path> [--skills-dir <dir> | --repo-root <dir>]");
    Deno.exit(2);
  }

  let findings: ISkillDuplicationFinding[];
  try {
    findings = skillsDir
      ? runSkillDuplicationCheck({ skillsDir, policyPath })
      : runRepoSkillDuplicationCheck({ repoRoot: repoRoot ?? Deno.cwd(), policyPath });
  } catch (e) {
    console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(2);
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`DUP [${finding.files.length} files] "${finding.text}"`);
      for (const file of finding.files) console.error(`  - ${file}`);
    }
    console.error(`Skill duplication: ${findings.length} repeated prose span(s) — exit 1`);
    Deno.exit(1);
  }
  console.log("Skill duplication: no repeated prose spans found.");
  Deno.exit(0);
}

if (import.meta.main) {
  main();
}
