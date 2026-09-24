#!/usr/bin/env -S deno run -A

/**
 * @module Ste100ProseRules
 * @path scripts/ste100_prose_rules.ts
 * @description Shared normalization and deterministic-STE counting core for the Phase 195
 *   authoring checks, consumed identically by the agent-prose and (Step 6) comment gates.
 * @architectural-layer Script
 * @dependencies [@std/assert]
 * @related-files ["scripts/check_agent_prose.ts", "scripts/config/ste100_rule_catalog.json", "tests/scripts/agent_prose_checker_test.ts"]
 *
 * Usage:
 *   Shared module — no standalone CLI. Imported by `scripts/check_agent_prose.ts`
 *   (agent-prose authoring gate) and by `scripts/check_ste100_comments.ts` (Step 6), so
 *   both entry points run the identical Issue 9 counting core (STE-5.1/6.3/6.6/8.1 and
 *   the STE-8.4-8.7 shared counting mechanics).
 */

export type SentenceMode = "procedural" | "descriptive";
export type ParagraphMode = SentenceMode | "mixed";
export type FindingSeverity = "error" | "advisory";

export interface ISteProseSentence {
  text: string;
  words: string[];
  mode: SentenceMode;
}

export interface ISteProseParagraph {
  sentences: ISteProseSentence[];
  paragraphMode: ParagraphMode;
}

export interface ISteNormalizedProse {
  paragraphs: ISteProseParagraph[];
  totalWordCount: number;
  semicolonCount: number;
}

export interface ISteFinding {
  ruleId: string;
  severity: FindingSeverity;
  sentence: string;
  message: string;
}

export const STE100_NORMALIZATION_VERSION = "norm-v1";
export const STE100_SENTENCE_MAX_WORDS = 20;
export const STE100_DESCRIPTIVE_PARAGRAPH_MAX_SENTENCES = 6;

/** Decodes `[label](url)` link labels and HTML entities in eligible prose.
 *  Keeps the label (counted) and drops the URL (a literal, not prose). */
export function decodeProseEntities(text: string): string {
  return text
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Strips emphasis and list markers that are markdown structure, not words. */
export function stripProseMarkers(text: string): string {
  return text
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^>\s*/gm, "");
}

const INLINE_ATOM_SPAN = /`[^`]*`|(?:"[^"\n]*"|'[^'\n]*')/g;
const SENTENCE_TERMINATORS = new Set([".", "!", "?"]);

/** Imperative verbs used to resolve a sentence as procedural rather than descriptive.
 *  Heuristic only — never treated as blocking evidence by itself. */
const IMPERATIVE_VERBS = new Set([
  "add",
  "apply",
  "confirm",
  "cover",
  "create",
  "do",
  "drive",
  "ensure",
  "execute",
  "fill",
  "fix",
  "follow",
  "honor",
  "keep",
  "omit",
  "preserve",
  "prevent",
  "reject",
  "remove",
  "require",
  "review",
  "run",
  "select",
  "set",
  "state",
  "submit",
  "use",
  "validate",
  "verify",
  "write",
]);

function isImperativeSentence(sentence: string): boolean {
  const firstWord = sentence.trim().split(/\s+/, 2)[0]?.toLowerCase() ?? "";
  if (IMPERATIVE_VERBS.has(firstWord)) return true;
  return /\b(must|should|shall)\b/.test(sentence);
}

/** Splits normalized prose into sentences, returning each sentence's text and the
 *  literal-atom mask used by the counter (semicolons inside atoms are not punctuation). */
function splitSentencesWithMask(text: string): { text: string; masked: Uint8Array }[] {
  // Resolve atoms to a per-char mask: character indexes inside a backtick/quoted literal.
  const masked = new Uint8Array(text.length);
  for (const match of text.matchAll(INLINE_ATOM_SPAN)) {
    for (let i = match.index; i < match.index + match[0].length; i++) masked[i] = 1;
  }

  const sentences: { text: string; masked: Uint8Array }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (masked[i] === 1) continue;
    if (SENTENCE_TERMINATORS.has(char)) {
      const rest = text.slice(i + 1);
      const trimmedRest = rest.trimStart();
      const endsRest = trimmedRest.length > 0 && /^[A-Z0-9]/.test(trimmedRest);
      if (rest.trim().length === 0 || endsRest) {
        const end = i + 1;
        const raw = text.slice(start, end).trim();
        if (raw.length > 0) {
          sentences.push({ text: raw, masked: masked.slice(start, end) });
        }
        start = end;
      }
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) sentences.push({ text: tail, masked: masked.slice(start) });
  return sentences;
}

function countSentenceWords(sentence: string): string[] {
  const tokens = sentence.split(/\s+/).filter((token) => token.length > 0);
  const words: string[] = [];
  for (const token of tokens) {
    const atomMatch = token.match(/^[`"'*(~]+(.+?)[`"'*)_~]+$/);
    if (atomMatch && !token.includes(".")) {
      words.push(atomMatch[1]);
      continue;
    }
    for (const atom of token.matchAll(INLINE_ATOM_SPAN)) {
      words.push(atom[0]);
    }
    if (!token.match(INLINE_ATOM_SPAN)) {
      words.push(token.replace(/^[`"'*(~]+|[`"'*)_~]+$/g, ""));
    }
  }
  return words.filter((word) => word.length > 0);
}

function countSemicolons(sentence: string, masked: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < sentence.length; i++) {
    if (sentence[i] === ";" && masked[i] === 0) count++;
  }
  return count;
}

function resolveParagraphMode(sentences: ISteProseSentence[], explicitMixed: boolean): ParagraphMode {
  if (explicitMixed) return "mixed";
  if (sentences.length === 0) return "descriptive";
  const modes = new Set(sentences.map((s) => s.mode));
  return modes.size === 1 ? ([...modes][0] as SentenceMode) : "mixed";
}

/** Normalizes eligible prose and counts paragraphs, sentences, and words under the
 *  shared Issue 9 counting mechanics. Inline literal atoms (backticked commands,
 *  identifiers, quotations, schema keys) are preserved and counted as single atomic
 *  words; their semicolons are excluded from the STE-8.1 punctctuation check. */
export function normalizeSteProse(text: string): ISteNormalizedProse {
  const decoded = decodeProseEntities(text);
  const stripped = stripProseMarkers(decoded);

  const paragraphs: ISteProseParagraph[] = [];
  let totalWordCount = 0;
  let semicolonCount = 0;

  for (const rawParagraph of stripped.split(/\n\s*\n/)) {
    const paragraphText = rawParagraph.trim();
    if (paragraphText.length === 0) continue;

    const sentences: ISteProseSentence[] = [];
    for (const split of splitSentencesWithMask(paragraphText)) {
      const words = countSentenceWords(split.text);
      if (words.length === 0) continue;
      semicolonCount += countSemicolons(split.text, split.masked);
      sentences.push({
        text: split.text,
        words,
        mode: isImperativeSentence(split.text) ? "procedural" : "descriptive",
      });
    }
    if (sentences.length === 0) continue;

    totalWordCount += sentences.reduce((sum, s) => sum + s.words.length, 0);
    paragraphs.push({ sentences, paragraphMode: resolveParagraphMode(sentences, false) });
  }

  return { paragraphs, totalWordCount, semicolonCount };
}

/** Applies the deterministic Issue 9 writing-rule subset to normalized prose. */
export function runDeterministicSteChecks(normalized: ISteNormalizedProse): ISteFinding[] {
  const findings: ISteFinding[] = [];
  for (const paragraph of normalized.paragraphs) {
    for (const sentence of paragraph.sentences) {
      if (sentence.words.length > STE100_SENTENCE_MAX_WORDS) {
        const ruleId = sentence.mode === "procedural" ? "STE-5.1" : "STE-6.3";
        findings.push({
          ruleId,
          severity: "error",
          sentence: sentence.text,
          message: `${ruleId}: ${sentence.words.length} words exceeds the ${STE100_SENTENCE_MAX_WORDS}-word limit`,
        });
      }
    }
    if (
      paragraph.paragraphMode === "descriptive" &&
      paragraph.sentences.length > STE100_DESCRIPTIVE_PARAGRAPH_MAX_SENTENCES
    ) {
      findings.push({
        ruleId: "STE-6.6",
        severity: "error",
        sentence: paragraph.sentences[0].text,
        message:
          `STE-6.6: ${paragraph.sentences.length} descriptive sentences exceed the ${STE100_DESCRIPTIVE_PARAGRAPH_MAX_SENTENCES}-sentence paragraph limit`,
      });
    }
  }
  if (normalized.semicolonCount > 0) {
    findings.push({
      ruleId: "STE-8.1",
      severity: "error",
      sentence: "",
      message: `STE-8.1: ${normalized.semicolonCount} semicolon(s) in eligible prose`,
    });
  }
  return findings;
}

/** Shared counting entry point used identically by both checkers — a single-number
 *  fingerprint of the normalized prose so identical fixtures yield identical counts
 *  regardless of which entry point consumed them (STE-8.4-8.7 consistency). */
export function summarizeSteCount(normalized: ISteNormalizedProse): string {
  const sentences = normalized.paragraphs.reduce((sum, p) => sum + p.sentences.length, 0);
  return [sentences, normalized.totalWordCount, normalized.semicolonCount].join("/");
}
