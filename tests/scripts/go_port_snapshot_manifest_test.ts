/**
 * @module GoPortSnapshotManifestTest
 * @path tests/scripts/go_port_snapshot_manifest_test.ts
 * @description Validates the deterministic snapshot manifest, its bounds, tracked-path filter and submodule parsing.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/snapshot_manifest.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  assertBounds,
  assertClean,
  contentHash,
  MAX_ENTRIES,
  MAX_MANIFEST_BYTES,
  parseSubmodules,
  selectTrackedPaths,
} from "../../scripts/go_port/snapshot_manifest.ts";

Deno.test("snapshot-manifest-deterministic: the content hash is stable and content-sensitive", async () => {
  const first = await contentHash({ parent: "abc", values: ["a", "b"] });
  const second = await contentHash({ parent: "abc", values: ["a", "b"] });
  assertEquals(first, second);
  const changed = await contentHash({ parent: "abc", values: ["a", "c"] });
  assertEquals(changed === first, false);
});

Deno.test("snapshot-manifest-dirty: a dirty worktree is refused unless allowed", () => {
  assertThrows(() => assertClean(" M src/a.ts\n", false), Error, "dirty");
  assertClean("", false);
  assertClean(" M src/a.ts\n", true);
});

Deno.test("snapshot-manifest-submodules: every recursive submodule path and SHA is parsed", () => {
  const text = [
    " 0fb8800263705f0a42d9f42bed9b1f7cb6fa7625 unslop-ts (v0.1.1-218-g0fb8800)",
    " bfb945d8f697eaf12d62aa1679749dfef1032ed6 exaix-team (heads/main)",
  ].join("\n");
  assertEquals(parseSubmodules(text), {
    "unslop-ts": "0fb8800263705f0a42d9f42bed9b1f7cb6fa7625",
    "exaix-team": "bfb945d8f697eaf12d62aa1679749dfef1032ed6",
  });
});

Deno.test("snapshot-manifest-bounds: the entry and byte caps are enforced", () => {
  assertBounds(MAX_ENTRIES, MAX_MANIFEST_BYTES);
  assertThrows(() => assertBounds(MAX_ENTRIES + 1, 1), Error, "entries");
  assertThrows(() => assertBounds(1, MAX_MANIFEST_BYTES + 1), Error, "bytes");
});

Deno.test("snapshot-manifest-secrets: untracked and local-secret paths are excluded", () => {
  assertEquals(
    selectTrackedPaths(["src/a.ts", ".env", ".exa/journal.db", "exaix-dev-docs/evidence/go-port/x.json", "deno.lock"]),
    ["src/a.ts", "deno.lock"],
  );
});
