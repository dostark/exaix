/**
 * @module PortalKnowledgeScorer
 * @path packages/core/src/func/portal_knowledge_scorer.ts
 * @description Pure request relevance scoring for cached portal knowledge.
 * @architectural-layer Core
 * @dependencies [packages/schemas/src/portal_knowledge.ts]
 * @related-files [packages/core/src/types/constants.ts, packages/schemas/src/portal_knowledge.ts]
 */

import type { IPortalKnowledge, IPortalKnowledgeRelevanceEntry } from "@exaix/schemas/portal_knowledge.ts";
import {
  PORTAL_KNOWLEDGE_SCORE_BASENAME,
  PORTAL_KNOWLEDGE_SCORE_BODY_TERM,
  PORTAL_KNOWLEDGE_SCORE_EXACT_PATH,
  PORTAL_KNOWLEDGE_SCORE_SYMBOL_NAME,
  PORTAL_KNOWLEDGE_SCORE_TAG_OR_TASK,
} from "../types/constants.ts";

export interface IPortalKnowledgeRequestSignals {
  taskType?: string;
  tags?: string[];
  filePaths?: string[];
  userPrompt: string;
}

interface IScoringSignals {
  paths: string[];
  bodyTerms: Set<string>;
  taskTerms: Set<string>;
}

function normalizePath(path: string): string | undefined {
  const slashPath = path.normalize("NFKC").replaceAll("\\", "/");
  if (/^(?:\/|[a-zA-Z]:)/.test(slashPath) || /[\p{Cc}\p{Cf}]/u.test(slashPath)) {
    return undefined;
  }
  const parts = slashPath.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return undefined;
  return parts.join("/");
}

function terms(value: string): Set<string> {
  return new Set(value.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function matchedTermCount(query: Set<string>, fields: string[]): number {
  let count = 0;
  for (const field of fields) {
    const fieldTerms = terms(field);
    for (const term of query) if (fieldTerms.has(term)) count++;
  }
  return count;
}

/** Keep portal-authored prose on one escaped Markdown data line. */
export function sanitizePortalKnowledgeText(value: string): string {
  return value.normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_{}\[\]()#+\-.!>|])/g, "\\$1");
}

function scoreFields(
  fields: string[],
  paths: string[],
  signals: IScoringSignals,
  symbolName: string | null,
): number {
  const normalizedPaths = paths.map(normalizePath).filter((path): path is string => !!path);
  const exact = normalizedPaths.some((path) =>
    signals.paths.some((signal) => signal.toLowerCase() === path.toLowerCase())
  );
  const basename = !exact &&
    normalizedPaths.some((path) =>
      signals.paths.some((signal) => signal.split("/").at(-1)?.toLowerCase() === path.split("/").at(-1)?.toLowerCase())
    );
  return (exact ? PORTAL_KNOWLEDGE_SCORE_EXACT_PATH : 0) +
    (basename ? PORTAL_KNOWLEDGE_SCORE_BASENAME : 0) +
    (symbolName ? matchedTermCount(signals.bodyTerms, [symbolName]) : 0) *
      PORTAL_KNOWLEDGE_SCORE_SYMBOL_NAME +
    matchedTermCount(signals.taskTerms, fields) * PORTAL_KNOWLEDGE_SCORE_TAG_OR_TASK +
    matchedTermCount(signals.bodyTerms, fields) * PORTAL_KNOWLEDGE_SCORE_BODY_TERM;
}

function candidate(
  kind: IPortalKnowledgeRelevanceEntry["kind"],
  id: string,
  detail: string,
  reference: string,
  score: number,
): IPortalKnowledgeRelevanceEntry | undefined {
  if (score <= 0) return undefined;
  const label = sanitizePortalKnowledgeText(id);
  if (!label) return undefined;
  return {
    kind,
    id,
    label,
    detail: sanitizePortalKnowledgeText(detail) || "(no description)",
    reference,
    score,
  };
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scoreSymbols(knowledge: IPortalKnowledge, signals: IScoringSignals): IPortalKnowledgeRelevanceEntry[] {
  const entries: IPortalKnowledgeRelevanceEntry[] = [];
  for (const symbol of knowledge.symbolMap) {
    const path = normalizePath(symbol.file);
    if (!path) continue;
    const fields = [symbol.name, symbol.signature, symbol.doc ?? "", path];
    const entry = candidate(
      "symbol",
      symbol.name,
      symbol.doc || symbol.signature,
      path,
      scoreFields(fields, [path], signals, symbol.name),
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

function scoreKeyFiles(knowledge: IPortalKnowledge, signals: IScoringSignals): IPortalKnowledgeRelevanceEntry[] {
  const entries: IPortalKnowledgeRelevanceEntry[] = [];
  for (const file of knowledge.keyFiles) {
    const path = normalizePath(file.path);
    if (!path) continue;
    const entry = candidate(
      "key_file",
      path,
      `${file.role}: ${file.description}`,
      path,
      scoreFields([path, file.role, file.description], [path], signals, null),
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

function scoreLayers(knowledge: IPortalKnowledge, signals: IScoringSignals): IPortalKnowledgeRelevanceEntry[] {
  const entries: IPortalKnowledgeRelevanceEntry[] = [];
  for (const layer of knowledge.layers) {
    const paths = [...layer.paths, ...layer.keyFiles].map(normalizePath)
      .filter((path): path is string => !!path);
    const entry = candidate(
      "layer",
      layer.name,
      layer.responsibility,
      paths[0] ?? `layer:${sanitizePortalKnowledgeText(layer.name)}`,
      scoreFields([layer.name, layer.responsibility, ...paths], paths, signals, null),
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

function scoreConventions(knowledge: IPortalKnowledge, signals: IScoringSignals): IPortalKnowledgeRelevanceEntry[] {
  const entries: IPortalKnowledgeRelevanceEntry[] = [];
  for (const convention of knowledge.conventions) {
    const paths = convention.examples.map(normalizePath)
      .filter((path): path is string => !!path);
    const entry = candidate(
      "convention",
      convention.name,
      convention.description,
      paths[0] ?? `convention:${sanitizePortalKnowledgeText(convention.name)}`,
      scoreFields([convention.name, convention.description, convention.category, ...paths], paths, signals, null),
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Score every matching AST item; the caller applies its own entry cap. */
export function scorePortalKnowledge(
  knowledge: IPortalKnowledge,
  request: IPortalKnowledgeRequestSignals,
): IPortalKnowledgeRelevanceEntry[] {
  const signals: IScoringSignals = {
    paths: (request.filePaths ?? []).map(normalizePath).filter((path): path is string => !!path),
    bodyTerms: terms(request.userPrompt),
    taskTerms: terms([request.taskType, ...(request.tags ?? [])].filter(Boolean).join(" ")),
  };
  if (!signals.paths.length && !signals.bodyTerms.size && !signals.taskTerms.size) return [];

  const entries = [
    ...scoreSymbols(knowledge, signals),
    ...scoreKeyFiles(knowledge, signals),
    ...scoreLayers(knowledge, signals),
    ...scoreConventions(knowledge, signals),
  ];

  entries.sort((a, b) =>
    b.score - a.score || compareCodePoint(a.kind, b.kind) ||
    compareCodePoint(a.id, b.id) || compareCodePoint(a.reference, b.reference)
  );
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}\0${entry.reference.toLowerCase()}\0${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
