/**
 * @module SkillSnapshot
 * @path packages/core/src/skills/skill_snapshot.ts
 * @description Pure parser and content-addressing for one skill revision. Canonical
 *   UTF-8 is used for both rendering and storage (CRLF to LF, exactly one terminal LF
 *   removed, NUL and lone CR rejected). The SHA-256 covers length-framed fields in a
 *   fixed order and the revision id is a UUIDv5 over that digest, so identical content
 *   replays identical canonical renderings.
 * @architectural-layer Core
 * @dependencies [@std/yaml, @exaix/schemas, ../func/skill_body.ts, ./skill_types.ts]
 * @related-files [packages/core/src/skills/skill_types.ts, packages/core/src/func/skill_body.ts]
 */

import { parse as parseYaml } from "@std/yaml";
import { DOGFOOD_FRONTMATTER_KEYS, SkillFrontmatterSchema, SkillSidecarSchema } from "@exaix/schemas/skill_folder.ts";
import { splitInstructionsAndExamples } from "../func/skill_body.ts";
import { MemoryBankSource, MemoryScope, SkillRootKind, SkillStatus } from "../types/enums.ts";
import { SkillTriggersSourceSchema } from "@exaix/schemas/runtime_skill.ts";
import type { IRuntimeSkill } from "@exaix/schemas/runtime_skill.ts";
import { DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS, DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS } from "../types/constants.ts";
import type {
  IResolvedSkillRoot,
  ISkillFallbackLimits,
  ISkillReferenceLinks,
  ISkillRevisionSnapshot,
  ISkillRootContext,
  ISkillYamlMap,
} from "./skill_types.ts";

/** Fixed UUIDv5 namespace for Exaix skill revision ids. */
export const SKILL_REVISION_NAMESPACE = "7ca2dd7f-933c-51d6-bb14-728efc21406f";

type TriggersSource = IRuntimeSkill["triggers_source"];
const TRIGGERS_SOURCE_OPTIONS = SkillTriggersSourceSchema.options;
const AUTHORED_TRIGGERS_SOURCE: TriggersSource = TRIGGERS_SOURCE_OPTIONS[0];
const DESCRIPTION_TRIGGERS_SOURCE: TriggersSource = TRIGGERS_SOURCE_OPTIONS[1];

/** Root kinds whose effective default status is DRAFT when the sidecar omits one. */
const DRAFT_DEFAULT_ROOTS: readonly SkillRootKind[] = [
  SkillRootKind.LEARNED,
  SkillRootKind.PROJECT,
];

/**
 * Canonical string form: CRLF to LF, exactly one terminal LF removed. Rejects NUL and
 * any lone CR (a CR not followed by LF) so an ambiguous byte stream never hashes.
 */
export function canonicalizeSkillText(text: string): string {
  if (text.includes("\0")) {
    throw new Error("skill text contains a NUL byte");
  }
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) {
    throw new Error("skill text contains a lone CR");
  }
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u32be(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function framed(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(text);
  return concatChunks([u32be(bytes.length), bytes]);
}

function framedOptional(text: string | null): Uint8Array<ArrayBuffer> {
  return text === null ? new Uint8Array([0]) : concatChunks([new Uint8Array([1]), framed(text)]);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Canonical content digest over the framed field vector. */
export async function computeSkillContentSha256(snapshot: ISkillRevisionSnapshot): Promise<string> {
  const references = [...snapshot.references].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const chunks: Uint8Array[] = [
    framed(canonicalizeSkillText(snapshot.skill_md)),
    framedOptional(snapshot.exaix_yaml === null ? null : canonicalizeSkillText(snapshot.exaix_yaml)),
    u32be(references.length),
  ];
  for (const reference of references) {
    chunks.push(framed(reference.path));
    chunks.push(framed(canonicalizeSkillText(reference.content)));
  }
  const digest = await crypto.subtle.digest("SHA-256", concatChunks(chunks));
  return toHex(new Uint8Array(digest));
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** UUIDv5 (SHA-1) over the lowercase digest hex under the fixed namespace. */
export async function computeRevisionId(contentSha256: string): Promise<string> {
  const namespaceBytes = hexToBytes(SKILL_REVISION_NAMESPACE.replace(/-/g, ""));
  const nameBytes = new TextEncoder().encode(contentSha256.toLowerCase());
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", concatChunks([namespaceBytes, nameBytes])),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Splits a `SKILL.md` into its YAML frontmatter and trimmed markdown body. */
function splitFrontmatter(skillMd: string): { frontmatter: ISkillYamlMap; body: string } {
  if (!skillMd.startsWith("---\n")) {
    throw new Error("SKILL.md does not start with YAML frontmatter");
  }
  const end = skillMd.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is not terminated");
  }
  const rawFrontmatter = parseYaml(skillMd.slice(4, end));
  if (rawFrontmatter === null || typeof rawFrontmatter !== "object" || Array.isArray(rawFrontmatter)) {
    throw new Error("SKILL.md frontmatter is not a mapping");
  }
  return {
    frontmatter: rawFrontmatter as ISkillYamlMap,
    body: skillMd.slice(end + 5).trim(),
  };
}

/** Validates frontmatter, allowing the named dogfood knowledge-base keys on the dogfood root. */
function validateFrontmatter(
  frontmatter: ISkillYamlMap,
  rootKind: SkillRootKind,
  folderName: string,
): { name: string; description: string } {
  if (rootKind === SkillRootKind.DOGFOOD) {
    const unknown = Object.keys(frontmatter).filter((key) => !DOGFOOD_FRONTMATTER_KEYS.includes(key));
    if (unknown.length > 0) {
      throw new Error(`dogfood frontmatter has unknown keys: ${unknown.join(", ")}`);
    }
  }
  const parsed = SkillFrontmatterSchema.parse(frontmatter);
  if (parsed.name !== folderName) {
    throw new Error(`frontmatter name "${parsed.name}" does not match folder "${folderName}"`);
  }
  return { name: parsed.name, description: parsed.description };
}

/** Words the description fallback never turns into trigger keywords. */
const FALLBACK_STOPWORDS: ReadonlySet<string> = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "before",
  "for",
  "from",
  "into",
  "more",
  "that",
  "the",
  "their",
  "then",
  "these",
  "this",
  "through",
  "using",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

const ASCII_WORD_PATTERN = /[a-z0-9]+/g;

const DEFAULT_FALLBACK_LIMITS: ISkillFallbackLimits = {
  minWordChars: DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS,
  maxKeywords: DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS,
};

function asciiWords(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(ASCII_WORD_PATTERN) ?? [];
}

/**
 * Trigger keywords for a skill that authored none. Name words come first and keep short words, then
 * description words that meet the minimum length. Stopwords and repeats drop, and the cap applies last.
 */
export function synthesizeFallbackKeywords(
  name: string,
  description: string,
  limits: ISkillFallbackLimits = DEFAULT_FALLBACK_LIMITS,
): string[] {
  const terms = [
    ...asciiWords(name),
    ...asciiWords(description).filter((word) => word.length >= limits.minWordChars),
  ];
  const unique = [...new Set(terms)].filter((term) => !FALLBACK_STOPWORDS.has(term));
  return unique.slice(0, limits.maxKeywords);
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE_PATTERN = /`+[^`]*`+/g;
const INLINE_LINK_PATTERN = /\]\(\s*(<[^>\n]*>|[^\s)]*)[^)]*\)/g;
const DEFINITION_PATTERN = /^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]*>|\S+)/;
const REFERENCE_USE_PATTERN = /\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/g;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const SUPPORTED_REFERENCE_TARGET = /^references\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const REFERENCES_SEGMENT = /(^|\/)references(\/|$)/i;

function outsideCode(body: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const opening = FENCE_PATTERN.exec(line);
    if (fence === null && opening) {
      fence = opening[1][0];
    } else if (fence !== null && FENCE_PATTERN.exec(line)?.[1][0] === fence) {
      fence = null;
    } else if (fence === null) {
      kept.push(line.replace(INLINE_CODE_PATTERN, ""));
    }
  }
  return kept.join("\n");
}

function referenceTargets(text: string): string[] {
  const definitions = new Map<string, string>();
  const bodyLines: string[] = [];
  for (const line of text.split("\n")) {
    const definition = DEFINITION_PATTERN.exec(line);
    if (definition) {
      const label = definition[1].trim().toLowerCase();
      if (!definitions.has(label)) definitions.set(label, definition[2].replace(/^<|>$/g, ""));
    } else {
      bodyLines.push(line);
    }
  }
  const targets: string[] = [];
  const prose = bodyLines.join("\n");
  for (const match of prose.matchAll(INLINE_LINK_PATTERN)) targets.push(match[1].replace(/^<|>$/g, ""));
  const withoutInline = prose.replace(INLINE_LINK_PATTERN, "]");
  for (const match of withoutInline.matchAll(REFERENCE_USE_PATTERN)) {
    const label = (match[2] === undefined || match[2] === "" ? match[1] : match[2]).trim().toLowerCase();
    const target = definitions.get(label);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

/** Splits the links of a body into supported `references/<slug>.md` targets and unsupported ones. Code and external links are ignored. */
export function analyzeReferenceLinks(body: string): ISkillReferenceLinks {
  const linked = new Set<string>();
  const unsupported = new Set<string>();
  for (const raw of referenceTargets(outsideCode(body))) {
    if (SCHEME_PATTERN.test(raw)) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const slashed = (value: string) => value.replaceAll("\\", "/");
    if (!REFERENCES_SEGMENT.test(slashed(raw)) && !REFERENCES_SEGMENT.test(slashed(decoded))) continue;
    const hash = raw.indexOf("#");
    const path = hash === -1 ? raw : raw.slice(0, hash);
    if (SUPPORTED_REFERENCE_TARGET.test(path)) linked.add(path);
    else unsupported.add(raw);
  }
  return { linked: [...linked].sort(), unsupported: [...unsupported].sort() };
}

/** Finds the `references/<slug>.md` targets a body links to, deduplicated and sorted. */
export function findLinkedReferencePaths(body: string): string[] {
  return analyzeReferenceLinks(body).linked;
}

/**
 * Pure parse of one revision snapshot into the runtime view. Filesystem loads and DB
 * rehydration share this path. Corrupt snapshots fail closed.
 */
export async function parseSkillSnapshot(
  snapshot: ISkillRevisionSnapshot,
  rootContext: ISkillRootContext,
  fallback: ISkillFallbackLimits = DEFAULT_FALLBACK_LIMITS,
): Promise<IRuntimeSkill> {
  const canonicalMd = canonicalizeSkillText(snapshot.skill_md);
  const { frontmatter, body } = splitFrontmatter(canonicalMd);
  const identity = validateFrontmatter(frontmatter, rootContext.rootKind, rootContext.name);

  const sidecar = snapshot.exaix_yaml === null
    ? null
    : SkillSidecarSchema.parse(parseYaml(canonicalizeSkillText(snapshot.exaix_yaml)));

  const { instructions, examples } = splitInstructionsAndExamples(body);
  const contentSha256 = await computeSkillContentSha256(snapshot);
  const revisionId = await computeRevisionId(contentSha256);
  const linked = new Set(findLinkedReferencePaths(body));

  const defaultStatus = DRAFT_DEFAULT_ROOTS.includes(rootContext.rootKind) ? SkillStatus.DRAFT : SkillStatus.ACTIVE;

  return {
    id: revisionId,
    skill_id: identity.name,
    name: identity.name,
    title: sidecar?.title ?? identity.name,
    description: identity.description,
    status: sidecar?.status ?? defaultStatus,
    source: rootContext.source,
    scope: rootContext.scope,
    project: rootContext.scope === MemoryScope.PROJECT ? rootContext.project ?? undefined : undefined,
    root_kind: rootContext.rootKind,
    path: rootContext.path,
    content_sha256: contentSha256,
    triggers: sidecar?.triggers ??
      { keywords: synthesizeFallbackKeywords(identity.name, identity.description, fallback) },
    triggers_source: sidecar?.triggers ? AUTHORED_TRIGGERS_SOURCE : DESCRIPTION_TRIGGERS_SOURCE,
    instructions,
    examples,
    constraints: sidecar?.constraints,
    output_requirements: sidecar?.output_requirements,
    quality_criteria: sidecar?.quality_criteria,
    critical: sidecar?.critical,
    effort: sidecar?.effort,
    thinking: sidecar?.thinking,
    tools: sidecar?.tools,
    compatible_with: sidecar?.applies_to,
    derived_from: sidecar?.derived_from,
    related_skills: sidecar?.related_skills,
    references: snapshot.references.map((reference) => ({
      path: reference.path,
      content: canonicalizeSkillText(reference.content),
      linked: linked.has(reference.path),
    })),
  };
}

/** The parse context for a skill folder in one admitted root. Root policy decides source and scope. */
export function buildRootContext(root: IResolvedSkillRoot, name: string): ISkillRootContext {
  return {
    rootKind: root.kind,
    name,
    path: name,
    project: root.project,
    source: root.kind === SkillRootKind.LEARNED ? MemoryBankSource.LEARNED : MemoryBankSource.USER,
    scope: root.kind === SkillRootKind.PROJECT && root.project !== null ? MemoryScope.PROJECT : MemoryScope.GLOBAL,
  };
}
