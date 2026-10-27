/**
 * @module EmbeddingStorage
 * @path packages/memory/src/embedding/embedding_storage.ts
 * @description File layout shared by the memory embedding services: the stored embedding and manifest shapes and the metadata lookup for search hits.
 * @architectural-layer Services
 * @dependencies [@exaix/core/types, @exaix/core, @std/path]
 * @related-files ["packages/memory/src/embedding/memory_embedding.ts", "packages/memory/src/embedding/provider_embedding_service.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { IEmbeddingSearchResult } from "@exaix/core/types";
import type { MemoryType } from "@exaix/core";
import { LEGACY_EMBEDDING_KIND } from "./embeddable_entry.ts";

const SUMMARY_LENGTH = 200;

/** Embedding file structure (stored as JSON). */
export interface IEmbeddingFile {
  id: string;
  title: string;
  text: string;
  vector: number[];
  created_at: string;
  kind?: MemoryType;
}

/** Manifest entry for an embedding. */
export interface IManifestEntry {
  id: string;
  title: string;
  embeddingFile: string;
}

/** Manifest file structure. */
export interface IEmbeddingManifest {
  generated_at: string;
  index: IManifestEntry[];
}

/** Creates the embeddings directory and an empty manifest when the manifest does not exist yet. */
export async function ensureEmbeddingManifest(embeddingsDir: string, manifestPath: string): Promise<void> {
  await ensureDir(embeddingsDir);
  if (await exists(manifestPath)) return;
  const manifest: IEmbeddingManifest = { generated_at: new Date().toISOString(), index: [] };
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
}

/** Loads the stored metadata of the index hits that reach the threshold, best match first, capped at the limit. */
export async function readEmbeddingSearchResults(
  embeddingsDir: string,
  indexResults: ReadonlyArray<{ id: string; similarity: number }>,
  threshold: number,
  limit: number,
): Promise<IEmbeddingSearchResult[]> {
  const results: IEmbeddingSearchResult[] = [];
  for (const ir of indexResults) {
    if (ir.similarity < threshold) continue;
    const embeddingPath = join(embeddingsDir, `${ir.id}.json`);
    try {
      const content = await Deno.readTextFile(embeddingPath);
      const embedding: IEmbeddingFile = JSON.parse(content);
      results.push({
        id: embedding.id,
        title: embedding.title,
        summary: embedding.text.substring(0, SUMMARY_LENGTH),
        similarity: ir.similarity,
        kind: embedding.kind ?? LEGACY_EMBEDDING_KIND,
      });
    } catch {
      continue;
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit);
}
