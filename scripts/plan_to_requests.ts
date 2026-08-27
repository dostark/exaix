#!/usr/bin/env -S deno run -A
/**
 * @module PlanToRequests
 * @path scripts/plan_to_requests.ts
 * @description Reads a phase-NN-*.md planning document and generates one request
 *   file per step into Workspace/Requests/. Supports YAML step-manifests and
 *   heading-scrape fallback.
 * @architectural-layer Script
 * @dependencies [@exaix/schemas, @std/path, @std/fs, @std/yaml]
 * @related-files [packages/schemas/src/step_manifest.ts, packages/schemas/src/request.ts]
 * Usage: plan_to_requests.ts <plan_path> [--out-dir <dir>] [--dry-run]
 */

import { basename, extname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { type StepManifest, StepManifestSchema } from "@exaix/schemas/step_manifest.ts";
import { RequestSchema } from "@exaix/schemas/request.ts";
import { type Opt, Reason } from "@exaix/core/types";

interface ParsedStep {
  stepNumber: number;
  sectionText: string;
}

interface FrontmatterFields {
  trace_id: string;
  identity_id: string;
  status: string;
  priority: number;
  tags: string[];
  skills?: string[];
}

function parseArgs(): { planPath: string; outDir: string; dryRun: boolean } {
  const args = Deno.args;
  if (args.length === 0) {
    console.error("Usage: plan_to_requests.ts <plan_path> [--out-dir <dir>] [--dry-run]");
    Deno.exit(1);
  }
  const planPath = args[0];
  let outDir = "Workspace/Requests";
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out-dir" && i + 1 < args.length) {
      outDir = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { planPath, outDir, dryRun };
}

function derivePlanSlug(planPath: string): string {
  const base = basename(planPath, extname(planPath));
  return base;
}

function extractSteps(content: string): ParsedStep[] {
  const stepRegex = /^#{2,3}\s+Step\s+(\d+)/gm;
  const steps: ParsedStep[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;
  // -1 (not 0) is the "no step seen yet" sentinel: a plan whose first step heading sits at
  // offset 0 — no frontmatter or preamble — would otherwise have that step silently dropped.
  let lastIndex = -1;
  let lastStepNumber = 0;

  while ((match = stepRegex.exec(content)) !== null) {
    const stepNumber = parseInt(match[1], 10);
    if (seen.has(stepNumber)) {
      console.error(`Duplicate step number ${stepNumber}; each step must have a unique number.`);
      Deno.exit(1);
    }
    seen.add(stepNumber);

    if (lastIndex >= 0) {
      steps.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex, match.index).trim() });
    }
    lastIndex = match.index;
    lastStepNumber = stepNumber;
  }

  if (lastIndex >= 0) {
    steps.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex).trim() });
  }

  if (steps.length === 0) {
    console.error("No step headings found in plan file; each step must start with '## Step N' or '### Step N'.");
    Deno.exit(1);
  }

  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}

function extractManifest(sectionText: string): StepManifest | null {
  const yamlMatch = sectionText.match(/```yaml\s*\n([\s\S]*?)```/);
  if (!yamlMatch) return null;

  const yamlBlock = yamlMatch[1];
  // Check for step-manifest marker
  if (!yamlBlock.includes("# step-manifest")) return null;

  try {
    const parsed = parseYaml(yamlBlock);
    if (typeof parsed !== "object" || parsed === null) return null;
    const result = StepManifestSchema.safeParse(parsed);
    if (result.success) return result.data;
    console.warn(`Manifest failed validation: ${result.error.message}; falling back to heading scrape`);
    return null;
  } catch {
    console.warn("YAML parse error; falling back to heading scrape");
    return null;
  }
}

function extractSection(text: string, heading: string): string {
  const regex = new RegExp(`\\*\\*${heading}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n---|$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

// ─── Phase-level context extraction (Phase 173 Step 1) ────────────────────────
// Real phase docs carry their why/why-not context under real markdown headings
// (`## Executive Summary`, `### Constraints`, `### Design Decisions`) which the
// bold-label `extractSection` above cannot match — hence these heading-based
// slice boundaries are a separate extractor family (GAP-1).

/** Minimum normalized-token length considered specific enough to match on
 *  (GAP-4) — shorter tokens like `ts` or `main` blanket-match every step. */
const MIN_OVERLAP_TOKEN_LENGTH = 5;
/** Per-source-block cap on included bullets (GAP-4) — keeps requests bounded. */
const MAX_RELEVANT_BULLETS = 8;
/** Universal tokens that appear in every step slice and must never match (GAP-4). */
const DEGENERATE_TOKENS = new Set(["step", "actions", "request"]);
const BACKTICK_TOKEN_REGEX = /`([^`\n]+)`/g;
const PATH_TOKEN_REGEX = /[A-Za-z0-9_][A-Za-z0-9_\-./]*\.(?:ts|md|json|toml|yaml|yml|sh)/g;
const TOKEN_TRIM_PATTERN = /^[\s.,:'"()[\]\\]+|[\s.,:'"()[\]\\]+$/g;

export interface IRelevantConstraints {
  /** Filtered `### Constraints` bullets sharing a token with the step slice. */
  constraints: string[];
  /** Filtered `### Design Decisions` bullets sharing a token with the step slice. */
  designDecisions: string[];
}

/**
 * Slices `content` from the `## Executive Summary` h2 boundary to the next heading of
 * level ≤ 2, then bounds it to the bold "The Problem / The Solution / The Goal"
 * paragraph run real phase docs use (everything after the Goal paragraph is dropped).
 * Returns "" when the doc has no such heading.
 */
export function extractExecutiveSummary(content: string): string {
  const sectionMatch = content.match(/(^|\n)## Executive Summary\s*\n([\s\S]*?)(?=\n#{1,2} |\n---|$)/);
  if (!sectionMatch) return "";
  const section = sectionMatch[2];
  const goalIndex = section.indexOf("**The Goal.");
  if (goalIndex === -1) return section.trim();
  // Keep through the end of the Goal paragraph (the next blank line after it starts).
  const goalEnd = section.indexOf("\n\n", goalIndex);
  return (goalEnd === -1 ? section : section.slice(0, goalEnd)).trim();
}

/** Normalizes a candidate token: lowercase, surrounding punctuation trimmed. */
function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(TOKEN_TRIM_PATTERN, "").trim();
}

/** Collects the filter's comparison tokens: backtick-quoted spans plus bare
 *  path-like tokens (constraints often cite files without backticks), passed
 *  through normalization / min-length / degenerate exclusion. */
function collectTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const regex of [BACKTICK_TOKEN_REGEX, PATH_TOKEN_REGEX]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const token = normalizeToken(match[1] ?? match[0]);
      if (token.length < MIN_OVERLAP_TOKEN_LENGTH) continue;
      if (DEGENERATE_TOKENS.has(token)) continue;
      tokens.add(token);
    }
  }
  return tokens;
}

/** Extracts `- `/`* ` bullet lines from a section slice, preserving document order. */
function extractBullets(sectionText: string): string[] {
  const bullets: string[] = [];
  for (const line of sectionText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const item = trimmed.slice(2).trim();
      if (item.length > 0) bullets.push(item);
    }
  }
  return bullets;
}

/** Filters raw bullets to those sharing ANY token with `stepTokens`; dedupes by
 *  normalized text, preserves document order, caps at MAX_RELEVANT_BULLETS. */
function filterBullets(bullets: string[], stepTokens: Set<string>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const bullet of bullets) {
    const key = normalizeToken(bullet);
    if (seen.has(key)) continue;
    const matches = [...collectTokens(bullet)].some((token) => stepTokens.has(token));
    if (!matches) continue;
    seen.add(key);
    kept.push(bullet);
    if (kept.length >= MAX_RELEVANT_BULLETS) break;
  }
  return kept;
}

/**
 * Filters the phase doc's `### Constraints` and `### Design Decisions` bullets down to
 * those sharing a backtick-quoted symbol/file-path or bare path-like token with the
 * step's own text (case-insensitive, min length + degenerate exclusions per GAP-4).
 * Docs without those exact headings yield empty lists (fail-safe toward omission).
 */
export function extractRelevantConstraints(content: string, stepSectionText: string): IRelevantConstraints {
  const stepTokens = collectTokens(stepSectionText);
  const sliceBlock = (heading: string): string[] => {
    const blockMatch = content.match(
      new RegExp(`(^|\\n)### ${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3} |$)`),
    );
    if (!blockMatch) return [];
    return filterBullets(extractBullets(blockMatch[2]), stepTokens);
  };
  return {
    constraints: sliceBlock("Constraints"),
    designDecisions: sliceBlock("Design Decisions"),
  };
}

function buildRequestFile(
  planSlug: string,
  stepNumber: number,
  manifest: StepManifest | null,
  sectionText: string,
  content?: Opt<string, Reason.OptionalInput>,
): string {
  const identityId = manifest?.identity ?? "senior-coder";
  const skills = manifest?.skills;
  const portal = manifest?.portal ?? "exaix-self";
  const targetBranch = manifest?.target_branch ?? `feat/${planSlug}-step-${stepNumber}`;
  const title = manifest?.title ?? `Step ${stepNumber}`;
  const dependsOn = manifest?.depends_on ?? (stepNumber > 1 ? [stepNumber - 1] : []);
  const priority = Math.max(0, Math.min(10, 10 - stepNumber));
  const tags = [planSlug, `step-${stepNumber}`, "dogfood"];

  // Build body from manifest acceptance or scrape
  const actionsText = extractSection(sectionText, "Actions");
  const archNotes = extractSection(sectionText, "Architecture Notes");
  const plannedTests = extractSection(sectionText, "Planned Tests");
  const successCriteria = extractSection(sectionText, "Success Criteria");

  const bodyParts: string[] = [];

  // Phase 173 Step 1 — the "why" block leads the request so the delegate sees the
  // step's purpose and bounds before its actions. Omitted entirely when the doc has
  // no Executive Summary (e.g. the legacy minimal fixture), preserving old output.
  if (content) {
    const whyBlock = buildWhyThisStepExists(content, sectionText);
    if (whyBlock) bodyParts.push(whyBlock);
  }

  if (actionsText) bodyParts.push(`## Actions\n\n${actionsText}`);
  if (archNotes) bodyParts.push(`## Architecture Notes\n\n${archNotes}`);
  if (plannedTests) bodyParts.push(`## Planned Tests\n\n${plannedTests}`);
  if (successCriteria) bodyParts.push(`## Success Criteria\n\n${successCriteria}`);

  const bodyLines: string[] = [
    `# ${title}`,
    "",
    `> Dogfood metadata — portal: \`${portal}\`; target_branch: \`${targetBranch}\``,
    "",
    ...bodyParts,
    "",
    `depends_on: ${JSON.stringify(dependsOn)}`,
  ];

  const frontmatter: FrontmatterFields = {
    trace_id: crypto.randomUUID(),
    identity_id: identityId,
    status: "pending",
    priority,
    tags,
  };
  if (skills) frontmatter.skills = skills;

  // Validate against RequestSchema before assembling
  const validation = RequestSchema.safeParse(frontmatter);
  if (!validation.success) {
    console.error(`Step ${stepNumber}: frontmatter fails RequestSchema: ${validation.error.message}`);
    Deno.exit(1);
  }

  const fmYamlLines = Object.entries(frontmatter).map(([k, v]) => {
    if (Array.isArray(v)) return `  ${k}:\n${v.map((item: string) => `    - ${item}`).join("\n")}`;
    return `  ${k}: ${JSON.stringify(v)}`;
  });

  return `---\n${fmYamlLines.join("\n")}\n---\n\n${bodyLines.join("\n")}\n`;
}

/**
 * Assembles the `## Why This Step Exists` block: the phase's Executive Summary plus
 * only Constraints/Design Decisions bullets sharing a token with this step's slice.
 * Returns "" when there is nothing to include (no Executive Summary AND no bullets),
 * so docs without context yield byte-identical legacy output.
 */
function buildWhyThisStepExists(content: string, sectionText: string): string {
  const summary = extractExecutiveSummary(content);
  const relevant = extractRelevantConstraints(content, sectionText);
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (relevant.constraints.length > 0) {
    parts.push(`### Relevant Constraints\n\n${relevant.constraints.map((b) => `- ${b}`).join("\n")}`);
  }
  if (relevant.designDecisions.length > 0) {
    parts.push(`### Relevant Design Decisions\n\n${relevant.designDecisions.map((b) => `- ${b}`).join("\n")}`);
  }
  if (parts.length === 0) return "";
  return `## Why This Step Exists\n\n${parts.join("\n\n")}`;
}

async function main(): Promise<void> {
  const { planPath, outDir, dryRun } = parseArgs();

  let content: string;
  try {
    content = await Deno.readTextFile(planPath);
  } catch {
    console.error(`Error: plan file not found or unreadable: ${planPath}`);
    Deno.exit(1);
  }

  const planSlug = derivePlanSlug(planPath);
  const steps = extractSteps(content);
  if (!dryRun) {
    await ensureDir(outDir);
  }

  let writtenCount = 0;
  for (const step of steps) {
    const manifest = extractManifest(step.sectionText);
    const fileName = `${planSlug}-step-${step.stepNumber}.md`;
    const filePath = join(outDir, fileName);
    const requestContent = buildRequestFile(planSlug, step.stepNumber, manifest, step.sectionText, content);

    if (dryRun) {
      console.log(
        `Would write: ${filePath} (identity: ${manifest?.identity ?? "senior-coder"}, priority: ${
          Math.max(0, Math.min(10, 10 - step.stepNumber))
        })`,
      );
    } else {
      // Atomic write: temp + rename
      const tmpPath = filePath + ".tmp";
      await Deno.writeTextFile(tmpPath, requestContent);
      await Deno.rename(tmpPath, filePath);
    }
    writtenCount++;
  }

  console.log(`${dryRun ? "Would write" : "Wrote"} ${writtenCount} request file(s) to ${outDir}`);
}

if (import.meta.main) {
  main();
}
