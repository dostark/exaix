/**
 * @module Ste100AssetsTest
 * @path tests/scenario_framework/tests/unit/ste100_assets_test.ts
 * @description Phase 195 Step 1 — RED-first tests for `ste100_assets.ts`: the
 *   reconstructable pre-conversion baseline (content-addressed freeze/restore of the
 *   exact dirty instruction state, with omitted active dependencies rejected and blob
 *   tampering detected) and the isolated-output preflight that rejects escaped,
 *   symlinked, sibling-prefix, and overlapping targets before any writes, while a clean
 *   target is created exclusively. Proves the two Step 1 assets obligations without
 *   touching the real conversion corpus.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/ste100_assets.ts, scripts/build_skills_index.ts, scripts/generate_skill_json.ts]
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, join, resolve } from "@std/path";
import {
  assertIsolatedTarget,
  createExclusiveIsolatedDir,
  freezeSte100Baseline,
  reconstructSte100Baseline,
  Ste100PathError,
} from "../../runner/ste100_assets.ts";

async function withTempRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "ste100-assets-" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("ste100 baseline: reconstructs the full dirty instruction state before conversion", async () => {
  await withTempRoot(async (root) => {
    const baselineDir = join(root, "baseline");
    const source = join(root, "AGENTS.md");
    const generated = join(root, "Memory/Skills/global/contract.json");
    const configuration = join(root, "exa.config.toml");
    await writeFile(source, "alpha v1\n");
    await writeFile(generated, '{"beta":1}\n');
    await writeFile(configuration, "gamma = true\n");

    const baseline = await freezeSte100Baseline({
      root,
      baselineDir,
      targets: [source, generated, configuration],
      commitHashes: ["parent-head", "edition-head"],
      kinds: {
        "AGENTS.md": "source",
        "Memory/Skills/global/contract.json": "generated",
        "exa.config.toml": "configuration",
      },
    });

    assertEquals(baseline.commitHashes, ["edition-head", "parent-head"]);
    assertEquals(baseline.entries.length, 3);
    assertEquals(baseline.entries.find((e) => e.relPath === "AGENTS.md")?.kind, "source");
    assertEquals(baseline.entries.find((e) => e.relPath === "Memory/Skills/global/contract.json")?.kind, "generated");
    assertEquals(baseline.entries.find((e) => e.relPath === "exa.config.toml")?.kind, "configuration");
    for (const entry of baseline.entries) {
      assertEquals(await exists(entry.blobPath), true, "content-addressed blob must be written");
    }
    assertEquals(await exists(join(baselineDir, "manifest.json")), true);

    // Make the working tree dirty after the freeze — the exact pre-conversion state is gone.
    await writeFile(source, "alpha v2 dirty\n");
    await writeFile(generated, '{"beta":2}\n');
    await writeFile(configuration, "gamma = false\n");

    const restored = await reconstructSte100Baseline(baseline);
    assertEquals(restored.length, 3);
    assertEquals(await Deno.readTextFile(source), "alpha v1\n");
    assertEquals(await Deno.readTextFile(generated), '{"beta":1}\n');
    assertEquals(await Deno.readTextFile(configuration), "gamma = true\n");
  });
});

Deno.test("ste100 baseline: rejects omitted active dependencies and tampered blobs", async () => {
  await withTempRoot(async (root) => {
    const baselineDir = join(root, "baseline");
    const source = join(root, "AGENTS.md");
    await writeFile(source, "alpha v1\n");
    const baseline = await freezeSte100Baseline({ root, baselineDir, targets: [source] });

    // A required dependency that was never frozen must block reconstruction.
    const omitted = { ...baseline, requiredPaths: [...baseline.requiredPaths, "MISSING.md"] };
    await assertRejects(
      () => reconstructSte100Baseline(omitted),
      Error,
      "MISSING.md",
    );

    // A tampered blob must fail hash validation instead of silently restoring altered bytes.
    const [entry] = baseline.entries;
    await Deno.writeTextFile(entry.blobPath, "tampered\n");
    await assertRejects(
      () => reconstructSte100Baseline(baseline),
      Error,
      "hash mismatch",
    );
  });
});

Deno.test("[security] ste100 isolated output: rejects escaped and sibling-prefix paths without writes", async () => {
  await withTempRoot(async (root) => {
    // A sibling whose name shares a prefix with the intended target leaf.
    await Deno.mkdir(join(root, "out-prefix"), { recursive: true });

    assertThrows(
      () => assertIsolatedTarget(`${root}/../escaped`, root),
      Ste100PathError,
      "is outside isolated root",
    );

    assertThrows(
      () => assertIsolatedTarget(join(root, "out"), root),
      Ste100PathError,
      "is confusable with sibling",
    );

    const outsideRoot = await Deno.makeTempDir({ prefix: "ste100-outside-" });
    try {
      await Deno.symlink(outsideRoot, join(root, "link"));
      assertThrows(
        () => assertIsolatedTarget(join(root, "link", "out"), root),
        Ste100PathError,
        "crosses symlinked path",
      );
    } finally {
      await Deno.remove(outsideRoot, { recursive: true }).catch(() => {});
    }

    // Nothing was written on any rejected path.
    assertEquals(await exists(join(root, "out")), false);
    assertEquals(await exists(join(root, "escaped")), false);

    // A clean target is accepted and created exclusively.
    const created = await createExclusiveIsolatedDir(join(root, "isolated"), root);
    assertEquals(created, resolve(join(root, "isolated")));
    assertEquals(await exists(join(root, "isolated")), true);
  });
});
