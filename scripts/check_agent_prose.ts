#!/usr/bin/env -S deno run -A

/**
 * @module CheckAgentProse
 * @path scripts/check_agent_prose.ts
 * @description Authoring gate for Phase 195 Step 2: inventories owned guidance, classifies
 *   sources/spans, applies the shared Issue 9 rules, and validates schema-v2 review evidence.
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path, zod]
 * @related-files ["scripts/ste100_prose_rules.ts", "scripts/config/ste100_rule_catalog.json", "scripts/config/agent_prose_policy.json", "tests/scripts/agent_prose_checker_test.ts"]
 *
 * Usage:
 *   deno run -A scripts/check_agent_prose.ts [--policy <policy.json>] [--focused <path>] [--json]
 *   deno task check:agent-prose  (default policy: scripts/config/agent_prose_policy.json)
 *   Exit codes: 0 current and passing; 1 scope/integrity gap, stale entry, containment
 *   escape, or confirmed violation; 2 malformed policy, read error, or focused path
 *   outside every registered root. Heuristics are advisory only and can never waive a
 *   deterministic violation.
 */

import { dirname, isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";
import { z } from "zod";
import {
  type FindingSeverity,
  normalizeSteProse,
  runDeterministicSteChecks,
  type SentenceMode,
  STE100_NORMALIZATION_VERSION,
} from "./ste100_prose_rules.ts";

export type AgentProseSourceKind = "instruction" | "documentation" | "mixed" | "unclassified";
export type AgentProseSpanKind = "instruction" | "documentation" | "literal";
export type AgentProseSpanMode = "procedural" | "descriptive" | "mixed";

export interface IAgentProseFinding {
  ruleId: string;
  severity: FindingSeverity;
  path: string;
  selector: string;
  sentence: string;
  message: string;
}

export interface IAgentProseResult {
  exitCode: 0 | 1 | 2;
  policyPath: string;
  errors: string[];
  findings: IAgentProseFinding[];
  unclassified: string[];
  sources: IProseSource[];
}

export interface IAgentProseCheckOptions {
  policyPath?: string;
  focused?: string;
}

export interface IRuleCatalogState {
  catalogHash: string;
  technicalTermsHash: string;
  rules: string[];
}

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const RuleDecisionSchema = z.object({
  ruleId: z.string().min(1),
  outcome: z.enum(["pass", "not-applicable"]),
  reason: z.string().min(1),
});
const ReviewSchema = z.object({
  reviewer: z.string().min(1),
  reviewedHash: HashSchema,
  ruleContractHash: HashSchema,
  technicalTermsHash: HashSchema,
  classificationHash: HashSchema,
  contextHash: HashSchema,
  ruleDecisions: z.array(RuleDecisionSchema),
  advisoryDecisions: z.array(z.object({
    findingHash: HashSchema,
    ruleId: z.string().min(1),
    outcome: z.enum(["corrected", "false-positive", "not-applicable"]),
    reason: z.string().min(1),
  })).default([]),
  unresolvedRuleIds: z.array(z.string().min(1)),
});
const ProseSpanSchema = z.object({
  selector: z.string().min(1),
  contentHash: HashSchema,
  kind: z.enum(["instruction", "documentation", "literal"]),
  mode: z.enum(["procedural", "descriptive", "mixed"]),
  reason: z.string().min(1),
  sentenceModes: z.array(z.enum(["procedural", "descriptive"])).default([]),
});
const ProseSourceSchema = z.object({
  path: z.string().min(1),
  contentHash: HashSchema,
  kind: z.enum(["instruction", "documentation", "mixed"]),
  spans: z.array(ProseSpanSchema),
  review: ReviewSchema.nullable().default(null),
});
const TechnicalTermSchema = z.object({
  term: z.string().min(1),
  partOfSpeech: z.enum(["noun", "verb"]),
  meaning: z.string().min(1),
  example: z.string().min(1),
});
const AgentProsePolicySchema = z.object({
  version: z.literal("2"),
  standard: z.literal("ASD-STE100 Issue 9"),
  extension: z.literal("Exaix STE Extension v1"),
  roots: z.array(z.string().min(1)),
  exclusions: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })).default([]),
  escapeAllowlist: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })).default([]),
  sources: z.array(ProseSourceSchema),
  technicalTerms: z.array(TechnicalTermSchema),
});

export type IAgentProsePolicy = z.infer<typeof AgentProsePolicySchema>;
export type IProseSource = z.infer<typeof ProseSourceSchema>;
export type IProseSpan = z.infer<typeof ProseSpanSchema>;
export type IReview = z.infer<typeof ReviewSchema>;

class PolicyError extends Error {}
class ReadError extends Error {}

export { PolicyError, ReadError };

const IMPERATIVE_FIRST_WORD =
  /^(?:use|run|keep|do|apply|reject|preserve|state|omit|add|ensure|validate|fix|review|create|write|require|confirm|execute|set|remove|prevent|follow|submit|cover|drive|deliver|select|compare|honour|honor)/i;
const DOCUMENTATION_HEADING = /documentation|reference|examples?|appendix/i;

function modeOf(prose: string): SentenceMode {
  return IMPERATIVE_FIRST_WORD.test(prose.trim()) ? "procedural" : "descriptive";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exported for test/sibling parallel use: the exact classification hash binding a
 *  source's spans (selector/kind/mode/hash/sentence modes), used to invalidate reviews
 *  when classifications change. */
export function hashProseSpans(spans: IProseSpan[]): Promise<string> {
  return sha256(
    sortedLines(spans.map((s) => `${s.selector}|${s.kind}|${s.mode}|${s.contentHash}|${s.sentenceModes.join(",")}`)),
  );
}

/** Exported for test/sibling parallel use: the context hash binding a source's
 *  obligation entry and required support bytes, per `tests/.../ste100/obligations.json`. */
export function contextHashForPath(path: string): Promise<string> {
  return obligationsContextHashes(path);
}

function sortedLines(values: string[]): string {
  return [...values].sort().join("\n");
}

function ruleCatalogPath(): string {
  return join(import.meta.dirname ?? ".", "config", "ste100_rule_catalog.json");
}

function rulesModulePath(): string {
  return join(import.meta.dirname ?? ".", "ste100_prose_rules.ts");
}

function obligationsPath(): string {
  return join(
    import.meta.dirname ?? ".",
    "..",
    "tests",
    "scenario_framework",
    "fixtures",
    "ste100",
    "obligations.json",
  );
}

function defaultPolicyPath(): string {
  return join(import.meta.dirname ?? ".", "config", "agent_prose_policy.json");
}

/** Loads and validates the schema-v2 agent prose policy. Malformed input is an exit-2
 *  condition. */
export async function loadAgentProsePolicy(policyPath: string): Promise<IAgentProsePolicy> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(policyPath);
  } catch (error) {
    throw new ReadError(`Cannot read policy ${policyPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: ReturnType<typeof AgentProsePolicySchema.safeParse>;
  try {
    parsed = AgentProsePolicySchema.safeParse(JSON.parse(raw));
  } catch {
    throw new PolicyError(`Malformed JSON in policy ${policyPath}`);
  }
  if (!parsed.success) {
    throw new PolicyError(`Malformed agent prose policy ${policyPath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function loadRuleCatalog(): Promise<IRuleCatalogState> {
  const raw = JSON.parse(await Deno.readTextFile(ruleCatalogPath())) as {
    rules: { ruleId: string }[];
    technicalTerms?: { term: string }[];
  };
  const rules = raw.rules.map((r) => r.ruleId);
  const terms = (raw.technicalTerms ?? []).map((t) => t.term).sort();
  const rulesModule = await Deno.readTextFile(rulesModulePath());
  const catalogHash = await sha256(
    `${STE100_NORMALIZATION_VERSION}\n${JSON.stringify(rules)}\n${JSON.stringify(terms)}\n${rulesModule}`,
  );
  const technicalTermsHash = await sha256(JSON.stringify(terms));
  return { catalogHash, technicalTermsHash, rules };
}

async function obligationsContextHashes(path: string): Promise<string> {
  try {
    const obligations = JSON.parse(await Deno.readTextFile(obligationsPath())) as {
      entries: { canonicalPath: string; supportPaths: string[] }[];
    };
    const entry = obligations.entries.find((e) => e.canonicalPath === path);
    if (!entry) return await sha256("[]");
    const hashes: string[] = [];
    for (const support of entry.supportPaths) {
      try {
        hashes.push(`${support}:${await sha256(await Deno.readTextFile(support))}`);
      } catch {
        hashes.push(`${support}:missing`);
      }
    }
    return await sha256(sortedLines(hashes));
  } catch {
    return await sha256("[]");
  }
}

function relativeSafe(root: string, target: string): string | null {
  const rel = relative(root, resolve(target));
  if (rel === "" || rel === "." || isAbsolute(rel) || rel.split(SEPARATOR).includes("..")) return null;
  return rel;
}

function isExcluded(policy: IAgentProsePolicy, relPath: string): boolean {
  return policy.exclusions.some((e) => relPath === e.path || relPath.startsWith(`${e.path}${SEPARATOR}`));
}

interface ICandidateFile {
  rootReal: string;
  relPath: string;
  absPath: string;
}

/** True when a relative path is a known, documented escape (back-compat symlink alias)
 *  allowed by the policy. An allowlisted escape is skipped silently, not errored. */
function isAllowlistedEscape(policy: IAgentProsePolicy, relPath: string): boolean {
  return policy.escapeAllowlist.some((e) => relPath === e.path);
}

/** Cycle-safe discovery: each real directory is visited at most once, aliases and
 *  symlinks collapse through realpath, and an escaping symlink is reported rather than
 *  silently skipped — unless it is an allowlisted, documented back-compat alias. */
export async function discoverProseCandidates(
  policy: IAgentProsePolicy,
  roots: string[],
): Promise<{ candidates: ICandidateFile[]; escapes: string[] }> {
  const candidates: ICandidateFile[] = [];
  const escapes: string[] = [];
  const visitedRealDirs = new Set<string>();
  const seenFiles = new Map<string, ICandidateFile>();

  for (const root of roots) {
    const queue = [root];
    while (queue.length > 0) {
      const dir = queue.pop()!;
      let realDir: string;
      try {
        realDir = await Deno.realPath(dir);
      } catch {
        continue;
      }
      if (visitedRealDirs.has(realDir)) continue;
      visitedRealDirs.add(realDir);

      const entries: Deno.DirEntry[] = [];
      try {
        for await (const entry of Deno.readDir(dir)) entries.push(entry);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const rel = relativeSafe(root, abs);
        if (!rel) {
          escapes.push(abs);
          continue;
        }
        if (isExcluded(policy, rel)) continue;

        let stat: Deno.FileInfo;
        try {
          stat = await Deno.lstat(abs);
        } catch {
          continue;
        }
        if (stat.isSymlink) {
          let realTarget: string;
          try {
            realTarget = await Deno.realPath(abs);
          } catch {
            continue;
          }
          if (relativeSafe(root, realTarget) === null) {
            if (!isAllowlistedEscape(policy, rel)) {
              escapes.push(abs);
            }
            continue;
          }
          let targetStat: Deno.FileInfo;
          try {
            targetStat = await Deno.stat(abs);
          } catch {
            continue;
          }
          if (targetStat.isDirectory) {
            queue.push(abs);
          } else {
            seenFiles.set(realTarget, { rootReal: root, relPath: rel, absPath: abs });
          }
          continue;
        }
        if (stat.isDirectory) {
          queue.push(abs);
          continue;
        }
        const key = await Deno.realPath(abs).catch(() => abs);
        seenFiles.set(key, { rootReal: root, relPath: rel, absPath: abs });
      }
    }
  }

  for (const candidate of seenFiles.values()) candidates.push(candidate);
  return { candidates, escapes };
}

export function classifySourcePath(relPath: string): AgentProseSourceKind {
  if (/(^|\/)AGENTS\.md$/.test(relPath)) return "instruction";
  if (/(^|\/)(.copilot\/)?skills\/[^/]+\/SKILL\.md$/.test(relPath)) return "instruction";
  if (/(^|\/)(.copilot\/)?prompts\/.+\.prompt\.md$/.test(relPath)) return "instruction";
  if (/(^|\/)Skills\/.+\.skill\.md$/.test(relPath) || /(^|\/)Agents\/.+\.md$/.test(relPath)) return "mixed";
  if (/docs\//.test(relPath)) return "documentation";
  if (/(^|\/)(skills|Skills)\/[^/]+\/.+\.(md|txt|yaml|yml)$/.test(relPath)) return "mixed";
  return "unclassified";
}

interface ISelectorProse {
  span: IProseSpan;
  text: string;
}

/** Extracts prose spans and their raw text (YAML values, heading sections, fenced
 *  literals) so deterministic checks run on the actual prose, not hash summaries. */
export async function extractProse(
  content: string,
  sourceKind: AgentProseSourceKind,
): Promise<ISelectorProse[]> {
  const results = new Map<string, ISelectorProse>();

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const fmBody = fmMatch?.[1];
  if (fmBody) {
    for (const line of fmBody.split("\n")) {
      const m = line.match(/^\s*([\w.-]+):\s*["']?([^"'\n]{2,})["']?\s*$/);
      if (!m) continue;
      const value = m[2].trim();
      if (value.split(/\s+/).length < 2) continue;
      const selector = `yaml:${m[1]}`;
      results.set(selector, {
        span: {
          selector,
          contentHash: await sha256(value),
          kind: sourceKind === "documentation" ? "documentation" : "instruction",
          mode: modeOf(value),
          reason: "frontmatter prose value",
          sentenceModes: [],
        },
        text: value,
      });
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const bodyLines = body.split("\n");
  let fenceOrdinal = 0;
  let currentHeading: string | null = null;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      currentHeading = heading[1].trim();
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      fenceOrdinal += 1;
      const open = fence[1];
      const close = new RegExp(`^\\s*${open}\\s*$`);
      const fenceLines: string[] = [];
      let j = i + 1;
      while (j < bodyLines.length && !close.test(bodyLines[j])) {
        fenceLines.push(bodyLines[j]);
        j++;
      }
      i = j;
      const fenceText = fenceLines.join("\n").trim();
      if (fenceText.length > 0) {
        const literal = DOCUMENTATION_HEADING.test(currentHeading ?? "") ||
          /(^|\s)(const|function|import|export|if|for|class|def|fn)\s|```/i.test(fenceText);
        const selector = `fence:${fenceOrdinal}`;
        results.set(selector, {
          span: {
            selector,
            contentHash: await sha256(fenceText),
            kind: literal ? "literal" : "instruction",
            mode: modeOf(fenceText),
            reason: literal ? "fenced code or example: preserved, not counted" : "fenced prose block",
            sentenceModes: [],
          },
          text: fenceText,
        });
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("---") || /^#{1,6}\s+/.test(trimmed)) continue;

    const inDocSection = currentHeading !== null && DOCUMENTATION_HEADING.test(currentHeading);
    const kind = inDocSection || sourceKind === "documentation" ? "documentation" : "instruction";
    const selector = currentHeading ? `heading:${currentHeading}` : "body";
    const existing = results.get(selector);
    if (existing) {
      existing.text = `${existing.text}\n${trimmed}`;
      existing.span.contentHash = await sha256(existing.text);
    } else {
      results.set(selector, {
        span: {
          selector,
          contentHash: await sha256(trimmed),
          kind,
          mode: modeOf(trimmed),
          reason: inDocSection ? "documentation section" : "guidance prose",
          sentenceModes: [],
        },
        text: trimmed,
      });
    }
  }

  return [...results.values()];
}

function hashSpans(spans: IProseSpan[]): Promise<string> {
  return hashProseSpans(spans);
}

/** Advisory extension heuristics (EXAIX-03 self-reflection, EXAIX-04 repetition).
 *  Advisory only — a deterministic violation can never be waived by these. */
export function detectAdvisoryProse(prose: string): IAgentProseFinding[] {
  const advisory: IAgentProseFinding[] = [];
  if (/\b(i think|i believe|let me|here is my reasoning)\b/i.test(prose)) {
    advisory.push({
      ruleId: "EXAIX-03",
      severity: "advisory",
      path: "",
      selector: "",
      sentence: prose.slice(0, 80),
      message: "EXAIX-03 advisory: possible self-reflection or thinking narration",
    });
  }
  if (/\b(as already mentioned|again, note|to repeat)\b/i.test(prose)) {
    advisory.push({
      ruleId: "EXAIX-04",
      severity: "advisory",
      path: "",
      selector: "",
      sentence: prose.slice(0, 80),
      message: "EXAIX-04 advisory: possible needless repetition",
    });
  }
  return advisory;
}

/** The central check: inventories discovery, recomputes hashes, validates reviews and
 *  rule decisions, and runs the deterministic rules over eligible spans. */
export async function runAgentProseCheck(options: IAgentProseCheckOptions): Promise<IAgentProseResult> {
  const policyPath = resolve(options.policyPath ?? defaultPolicyPath());
  const policy = await loadAgentProsePolicy(policyPath);
  const catalog = await loadRuleCatalog();
  const policyDir = dirname(policyPath);
  const roots: string[] = [];
  for (const root of policy.roots) {
    roots.push(await Deno.realPath(resolve(policyDir, root)));
  }
  const uniqueRoots = [...new Set(roots)];

  const errors: string[] = [];
  const findings: IAgentProseFinding[] = [];
  const unclassified: string[] = [];
  const inventory: IProseSource[] = [];

  if (options.focused) {
    const focusedAbs = resolve(options.focused);
    const inside = uniqueRoots.some((root) => focusedAbs === root || relativeSafe(root, focusedAbs) !== null);
    if (!inside) {
      return {
        exitCode: 2,
        policyPath,
        errors: [`Focused path ${options.focused} is outside every registered root`],
        findings,
        unclassified,
        sources: [],
      };
    }
  }

  const { candidates, escapes } = await discoverProseCandidates(policy, uniqueRoots);
  for (const escape of escapes) errors.push(`Escaping symlink discovered: ${escape}`);

  const sourcesByRel = new Map<string, IProseSource>();
  for (const source of policy.sources) sourcesByRel.set(source.path, source);

  const discoveredFiles = new Map<string, ICandidateFile>();
  for (const candidate of candidates) {
    const real = await Deno.realPath(candidate.absPath).catch(() => candidate.absPath);
    const rel = relativeSafe(candidate.rootReal, real) ?? candidate.relPath;
    if (!discoveredFiles.has(rel)) discoveredFiles.set(rel, candidate);
  }

  for (const entry of policy.sources) {
    const candidate = discoveredFiles.get(entry.path);
    if (!candidate && !options.focused) {
      errors.push(`Policy source missing from discovery: ${entry.path}`);
      continue;
    }
    const absPath = candidate?.absPath ?? resolve(policyDir, entry.path);
    let content: string;
    try {
      content = await Deno.readTextFile(absPath);
    } catch (error) {
      errors.push(`Read error for ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const contentHash = await sha256(content);
    if (contentHash !== entry.contentHash) {
      errors.push(`Stale content hash for ${entry.path}: disk content changed since inventory`);
    }

    const extracted = await extractProse(content, entry.kind);
    const extractedSelectors = new Set(extracted.map((e) => e.span.selector));
    for (const item of extracted) {
      const recorded = entry.spans.find((s) => s.selector === item.span.selector);
      if (!recorded) {
        errors.push(`Missing inventory span ${item.span.selector} for ${entry.path}`);
        continue;
      }
      if (recorded.kind !== item.span.kind || recorded.mode !== item.span.mode) {
        errors.push(`Stale span classification ${item.span.selector} for ${entry.path}`);
      }
    }
    for (const recorded of entry.spans) {
      if (!extractedSelectors.has(recorded.selector)) {
        errors.push(`Recorded span ${recorded.selector} missing from ${entry.path}`);
      }
    }

    const classificationHash = await hashSpans(entry.spans);
    const contextHash = await obligationsContextHashes(entry.path);

    if (entry.kind !== "documentation") {
      const review = entry.review;
      if (!review) {
        errors.push(`Missing review for ${entry.path}`);
      } else {
        if (review.reviewedHash !== contentHash) errors.push(`Review reviewedHash stale for ${entry.path}`);
        if (review.ruleContractHash !== catalog.catalogHash) {
          errors.push(`Review ruleContractHash stale for ${entry.path}`);
        }
        if (review.technicalTermsHash !== catalog.technicalTermsHash) {
          errors.push(`Review technicalTermsHash stale for ${entry.path}`);
        }
        if (review.classificationHash !== classificationHash) {
          errors.push(`Review classificationHash stale for ${entry.path}`);
        }
        if (review.contextHash !== contextHash) errors.push(`Review contextHash stale for ${entry.path}`);
        if (review.unresolvedRuleIds.length > 0) {
          errors.push(`Review has unresolved rules for ${entry.path}: ${review.unresolvedRuleIds.join(", ")}`);
        }
        const decided = new Set(review.ruleDecisions.map((d) => d.ruleId));
        for (const ruleId of catalog.rules) {
          if (!decided.has(ruleId)) {
            errors.push(`Review for ${entry.path} lacks a decision for ${ruleId}`);
            continue;
          }
          const decision = review.ruleDecisions.find((d) => d.ruleId === ruleId)!;
          if (decision.outcome === "not-applicable" && decision.reason.trim().length === 0) {
            errors.push(`not-applicable decision for ${ruleId} lacks a reason`);
          }
        }
      }
    }

    for (const item of extracted) {
      const span = item.span;
      if (span.kind === "documentation" || span.kind === "literal") continue;
      const normalized = normalizeSteProse(item.text);
      const deterministic = runDeterministicSteChecks(normalized);
      for (const finding of deterministic) {
        findings.push({
          ruleId: finding.ruleId,
          severity: "error",
          path: entry.path,
          selector: span.selector,
          sentence: finding.sentence,
          message: finding.message,
        });
      }
      for (const advisory of detectAdvisoryProse(item.text)) {
        findings.push({ ...advisory, path: entry.path, selector: span.selector });
      }
    }

    inventory.push({ ...entry });
  }

  for (const [rel, candidate] of discoveredFiles) {
    if (!sourcesByRel.has(rel)) {
      unclassified.push(`${rel}:${classifySourcePath(candidate.relPath === rel ? rel : candidate.relPath)}`);
    }
  }

  const hasErrors = escapes.length > 0 || errors.length > 0 || unclassified.length > 0;
  const hasConfirmed = findings.some((f) => f.severity === "error");
  return {
    exitCode: hasErrors || hasConfirmed ? 1 : 0,
    policyPath,
    errors,
    findings,
    unclassified,
    sources: inventory,
  };
}

if (import.meta.main) {
  const args = Deno.args;
  let focused: string | undefined;
  let policyPath: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--focused" && args[i + 1]) focused = args[i + 1];
    if (args[i] === "--policy" && args[i + 1]) policyPath = args[i + 1];
    if (args[i] === "--json") json = true;
  }
  runAgentProseCheck({ policyPath, focused }).then(
    (result) => {
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const error of result.errors) console.error(`  - ${error}`);
        for (const finding of result.findings) {
          console.error(`  - [${finding.severity}] ${finding.path} ${finding.selector}: ${finding.message}`);
        }
        for (const item of result.unclassified) console.error(`  - [unclassified] ${item}`);
        console.error(
          `agent-prose: exit ${result.exitCode} — ${result.findings.length} finding(s), ${result.errors.length} error(s), ${result.unclassified.length} unclassified`,
        );
      }
      Deno.exit(result.exitCode);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(2);
    },
  );
}
