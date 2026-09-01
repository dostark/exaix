/**
 * @module EmbeddableEntry
 * @path packages/memory/src/embedding/embeddable_entry.ts
 * @description Pure helpers that normalize any embeddable memory entry into its embedding-index
 *   identity, display title, and text chunks — per-type text-extraction rules live here so write
 *   paths, rebuilds, and both embedding services share one definition.
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/memory.ts", "packages/memory/src/embedding/provider_embedding_service.ts", "packages/memory/src/embedding/memory_embedding.ts", "packages/memory/src/bank/memory_bank.ts"]
 */
import type { IEmbeddableMemoryEntry } from "@exaix/core/types";
import { MEMORY_OVERVIEW_EMBED_CHAR_BUDGET, MemoryType } from "@exaix/core";

/** Kind assumed for embedding-index entries written before the kind field existed (learnings only). */
export const LEGACY_EMBEDDING_KIND: MemoryType = MemoryType.LEARNING;

/** Deterministic synthetic key for a project's overview (one per portal, not a collection). */
export function overviewEmbeddingId(portal: string): string {
  return `${portal}:overview`;
}

/** Embedding-index identity for an entry; pattern/decision entries must already carry their backfilled id. */
export function embeddableId(entry: IEmbeddableMemoryEntry): string {
  switch (entry.kind) {
    case MemoryType.LEARNING:
      return entry.learning.id;
    case MemoryType.PATTERN:
      if (!entry.pattern.id) {
        throw new Error(`Pattern '${entry.pattern.name}' has no id — backfill ids before embedding`);
      }
      return entry.pattern.id;
    case MemoryType.DECISION:
      if (!entry.decision.id) {
        throw new Error(`Decision '${entry.decision.decision}' has no id — backfill ids before embedding`);
      }
      return entry.decision.id;
    case MemoryType.EXECUTION:
      return entry.execution.trace_id;
    case MemoryType.PROJECT:
      return overviewEmbeddingId(entry.portal);
  }
}

/** Display title for the embedding index entry, matching the keyword-search title conventions. */
export function embeddableTitle(entry: IEmbeddableMemoryEntry): string {
  switch (entry.kind) {
    case MemoryType.LEARNING:
      return entry.learning.title;
    case MemoryType.PATTERN:
      return entry.pattern.name;
    case MemoryType.DECISION:
      return `Decision: ${entry.decision.date}`;
    case MemoryType.EXECUTION:
      return `Execution: ${entry.execution.trace_id.slice(0, 8)}`;
    case MemoryType.PROJECT:
      return `${entry.portal} Overview`;
  }
}

/** Text chunks to embed, extracted per type: pattern → name+description; decision → decision+rationale;
 *  execution → summary (+ lessons_learned); overview → the full overview chunked at the configured budget. */
export function embeddableTextChunks(entry: IEmbeddableMemoryEntry): string[] {
  switch (entry.kind) {
    case MemoryType.LEARNING:
      return [`${entry.learning.title} ${entry.learning.description}`];
    case MemoryType.PATTERN:
      return [`${entry.pattern.name} ${entry.pattern.description}`];
    case MemoryType.DECISION:
      return [`${entry.decision.decision} ${entry.decision.rationale}`];
    case MemoryType.EXECUTION: {
      const lessons = entry.execution.lessons_learned?.length ? ` ${entry.execution.lessons_learned.join(" ")}` : "";
      return [`${entry.execution.summary}${lessons}`];
    }
    case MemoryType.PROJECT: {
      const text = entry.overview;
      if (!text) return [];
      const budget = MEMORY_OVERVIEW_EMBED_CHAR_BUDGET;
      if (text.length <= budget) return [text];
      const chunks: string[] = [];
      for (let start = 0; start < text.length; start += budget) {
        chunks.push(text.slice(start, start + budget));
      }
      return chunks;
    }
  }
}

/** Index id for chunk `index` of an entry: the base id for the first chunk, `<base>:<n>` beyond it. */
export function chunkEmbeddingId(baseId: string, index: number): string {
  return index === 0 ? baseId : `${baseId}:${index}`;
}
