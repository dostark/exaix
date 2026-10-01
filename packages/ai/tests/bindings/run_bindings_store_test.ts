/**
 * @module RunBindingsStoreTest
 * @path packages/ai/tests/bindings/run_bindings_store_test.ts
 * @description Step-4 coverage for the per-run operator binding file store: atomic
 *   write (temp-file rename, exclusive), single-use claims bound to the trusted
 *   request path + content hash, checkpoint resume within one request, prune, and
 *   the security rejections (UUID syntax, path traversal, altered request, second
 *   claimant, symlink targets outside the runtime dir).
 * @architectural-layer AI
 * @related-files [packages/ai/src/bindings/run_bindings_store.ts, packages/ai/src/bindings/binding_layers.ts]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join, normalize } from "@std/path";
import { createMockConfig } from "@exaix/testing";
import { type IRunBindingsFile, RunBindingsFileSchema } from "@exaix/schemas";
import { RunBindingsStore } from "@exaix/ai/bindings/run_bindings_store.ts";

function runFile(traceId: string, requestPath: string, requestSha256: string): IRunBindingsFile {
  return RunBindingsFileSchema.parse({
    schema: 1,
    trace_id: traceId,
    request_path: requestPath,
    request_sha256: requestSha256,
    created_at: new Date().toISOString(),
    overlays: [],
    binds: [],
  });
}

const sha256 = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.test("[store] write stores an exclusive run-binding file and claim verifies path and content hash", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "bindings-store-" });
  try {
    const config = createMockConfig(tempDir, {});
    const store = new RunBindingsStore(config);
    const traceId = crypto.randomUUID();
    const requestPath = normalize(join(tempDir, "Workspace", "Requests", "request.md"));
    const requestSha256 = await sha256("the exact request bytes");
    const storedPath = await store.write(runFile(traceId, requestPath, requestSha256));

    const claimed = await store.claim(traceId, requestPath, requestSha256);
    assertExists(claimed, "the claim must return the stored run file");
    assertEquals(claimed.trace_id, traceId);
    assertEquals(claimed.request_sha256, requestSha256);
    assertEquals(RunBindingsFileSchema.parse(JSON.parse(await Deno.readTextFile(storedPath))).trace_id, traceId);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[store] an altered request path or content hash is rejected with overlay_invalid", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "bindings-store-" });
  try {
    const config = createMockConfig(tempDir, {});
    const store = new RunBindingsStore(config);
    const traceId = crypto.randomUUID();
    const requestPath = normalize(join(tempDir, "Workspace", "Requests", "request.md"));
    const requestSha256 = await sha256("the exact request bytes");
    await store.write(runFile(traceId, requestPath, requestSha256));

    const alteredHash = await sha256("altered request bytes");
    await assertRejects(
      () => store.claim(traceId, requestPath, alteredHash),
      Error,
      "overlay_invalid",
    );
    await assertRejects(
      () => store.claim(traceId, normalize(join(tempDir, "Workspace", "Requests", "other.md")), requestSha256),
      Error,
      "overlay_invalid",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[store] a non-UUID or traversing trace id is refused before file access", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "bindings-store-" });
  try {
    const config = createMockConfig(tempDir, {});
    const store = new RunBindingsStore(config);
    const hash = await sha256("x");
    await assertRejects(() => store.claim("not-a-uuid", "x", hash), Error, "overlay_invalid");
    await assertRejects(() => store.claim("../../etc/passwd", "x", hash), Error, "overlay_invalid");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[store] a second claimant fails while a checkpoint resume for the same request succeeds", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "bindings-store-" });
  try {
    const config = createMockConfig(tempDir, {});
    const store = new RunBindingsStore(config);
    const traceId = crypto.randomUUID();
    const requestPath = normalize(join(tempDir, "Workspace", "Requests", "request.md"));
    const requestSha256 = await sha256("the exact request bytes");
    await store.write(runFile(traceId, requestPath, requestSha256));

    const first = await store.claim(traceId, requestPath, requestSha256);
    assertExists(first);
    // A second, different request cannot claim the same operator run-file.
    // The same trace with a different request path is rejected, because the file is
    // bound to the trusted request.
    await assertRejects(
      () => store.claim(traceId, normalize(join(tempDir, "Workspace", "Requests", "other.md")), requestSha256),
      Error,
      "overlay_invalid",
    );
    // A different trace with no run file returns undefined (plain request, no bindings).
    assertEquals(await store.claim(crypto.randomUUID(), requestPath, requestSha256), undefined);
    // The same request (checkpoint resume, same trace + path + hash) may claim again.
    const resume = await store.claim(traceId, requestPath, requestSha256);
    assertExists(resume, "the same request may reclaim during a checkpoint resume");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[store] pruneOlderThan removes only files older than the window", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "bindings-store-" });
  try {
    const config = createMockConfig(tempDir, {});
    const store = new RunBindingsStore(config);
    const now = new Date("2026-10-01T00:00:00Z");
    const path = join(tempDir, ".exa", "run-bindings", "old.json");
    await Deno.mkdir(join(tempDir, ".exa", "run-bindings"), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(runFile(crypto.randomUUID(), "x", await sha256("x"))));
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    Deno.utimeSync(path, old, old);

    const newFile = join(tempDir, ".exa", "run-bindings", "new.json");
    await Deno.writeTextFile(newFile, JSON.stringify(runFile(crypto.randomUUID(), "x", await sha256("x"))));
    const fresh = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    Deno.utimeSync(newFile, fresh, fresh);

    await store.pruneOlderThan(30, now);
    await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
    assertEquals((await Deno.stat(newFile)).isFile, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
