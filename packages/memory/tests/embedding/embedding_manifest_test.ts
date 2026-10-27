/**
 * @module EmbeddingManifestTest
 * @path packages/memory/tests/embedding/embedding_manifest_test.ts
 * @description The shared manifest setup creates the embeddings directory and an empty manifest once, and leaves an existing manifest alone.
 * @architectural-layer Test
 * @related-files [packages/memory/src/embedding/embedding_storage.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { ensureEmbeddingManifest, type IEmbeddingManifest } from "../../src/embedding/embedding_storage.ts";

Deno.test("a missing embeddings directory gets created together with an empty manifest", async () => {
  await withTempDir(async (root) => {
    const embeddingsDir = join(root, "nested", "embeddings");
    const manifestPath = join(embeddingsDir, "manifest.json");

    await ensureEmbeddingManifest(embeddingsDir, manifestPath);

    const manifest: IEmbeddingManifest = JSON.parse(await Deno.readTextFile(manifestPath));
    assertEquals(manifest.index, []);
    assertEquals(Number.isNaN(Date.parse(manifest.generated_at)), false);
  });
});

Deno.test("an existing manifest is kept as it is", async () => {
  await withTempDir(async (root) => {
    const manifestPath = join(root, "manifest.json");
    const existing: IEmbeddingManifest = {
      generated_at: "2026-01-01T00:00:00.000Z",
      index: [{ id: "a", title: "A", embeddingFile: "a.json" }],
    };
    await Deno.writeTextFile(manifestPath, JSON.stringify(existing));

    await ensureEmbeddingManifest(root, manifestPath);

    assertEquals(JSON.parse(await Deno.readTextFile(manifestPath)), existing);
  });
});
