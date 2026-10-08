/**
 * @module Ste100AssetsTest
 * @path tests/scenario_framework/tests/unit/ste100_assets_test.ts
 * @description Phase 195 Step 1 — RED-first tests for `ste100_assets.ts`: the
 *   reconstructable pre-conversion baseline (content-addressed freeze/restore of the
 *   exact dirty instruction state, with omitted active dependencies rejected and blob
 *   tampering detected) and the isolated skill/overlay generation. The isolated-output
 *   preflight guards live in the sibling security test. Proves the two Step 1 assets
 *   obligations without touching the real conversion corpus.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/ste100_assets.ts, scripts/skill_catalog_loader.ts]
 */

import { REPO_ROOT } from "@exaix/testing";
import { assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { freezeSte100Baseline, reconstructSte100Baseline, runIsolatedGenerator } from "../../runner/ste100_assets.ts";
import { withTempRoot } from "./helpers/ste100_assets_fixture.ts";

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

async function writeSkillFolder(sourceDir: string, name: string, extra: Record<string, string> = {}): Promise<void> {
  await writeFile(
    join(sourceDir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\nBody of ${name}.\n`,
  );
  for (const [file, content] of Object.entries(extra)) await writeFile(join(sourceDir, name, file), content);
}

Deno.test("ste100 isolated skills: copies validated skill folders byte for byte into the arm root", async () => {
  await withTempRoot(async (root) => {
    const source = join(root, "source");
    await writeSkillFolder(source, "alpha-skill", { "exaix.yaml": "title: Alpha\n" });
    await writeSkillFolder(source, "beta-skill", { "references/notes.md": "Reference notes.\n" });
    const result = await runIsolatedGenerator({
      kind: "skills",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-skills"),
    });
    assertEquals(result.errors, []);
    assertEquals(result.success, true);
    assertEquals(result.generated.length, 2);
    for (
      const rel of [
        "alpha-skill/SKILL.md",
        "alpha-skill/exaix.yaml",
        "beta-skill/SKILL.md",
        "beta-skill/references/notes.md",
      ]
    ) {
      assertEquals(
        await Deno.readTextFile(join(root, "arm-skills", rel)),
        await Deno.readTextFile(join(source, rel)),
        rel,
      );
    }
  });
});

Deno.test("ste100 isolated skills: an invalid folder copies nothing and reports its reason", async () => {
  await withTempRoot(async (root) => {
    const source = join(root, "source");
    await writeSkillFolder(source, "good-skill");
    await writeFile(join(source, "broken-skill", "SKILL.md"), "no frontmatter");
    const result = await runIsolatedGenerator({
      kind: "skills",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-skills"),
    });
    assertEquals(result.success, false);
    assertEquals(result.errors, ["broken-skill: invalid_frontmatter"]);
    assertEquals(await exists(join(root, "arm-skills", "good-skill")), false);
  });
});

Deno.test("ste100 isolated skills: check mode validates without writing any folder", async () => {
  await withTempRoot(async (root) => {
    const source = join(root, "source");
    await writeSkillFolder(source, "alpha-skill");
    const result = await runIsolatedGenerator({
      kind: "skills",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-skills"),
    }, { check: true });
    assertEquals(result.success, true);
    assertEquals(result.generated.length, 1);
    assertEquals(await exists(join(root, "arm-skills", "alpha-skill")), false);
  });
});

Deno.test("ste100 isolated dogfood skills: the repository corpus is copied as 28 folders and the source is unchanged", async () => {
  await withTempRoot(async (root) => {
    const source = join(REPO_ROOT, ".copilot", "skills");
    const before = await Deno.readTextFile(join(source, "commit", "exaix.yaml"));
    const result = await runIsolatedGenerator({
      kind: "dogfood-skills",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-dogfood"),
    });
    assertEquals(result.errors, []);
    assertEquals(result.generated.length, 28);
    assertEquals(
      await Deno.readTextFile(join(root, "arm-dogfood", "commit", "SKILL.md")),
      await Deno.readTextFile(join(source, "commit", "SKILL.md")),
    );
    assertEquals(await Deno.readTextFile(join(root, "arm-dogfood", "commit", "exaix.yaml")), before);
    assertEquals(await Deno.readTextFile(join(source, "commit", "exaix.yaml")), before);
  });
});

Deno.test("ste100 isolated dogfood skills: a Blueprint-style folder under the dogfood kind reports its reason", async () => {
  await withTempRoot(async (root) => {
    const source = join(root, "source");
    await writeFile(join(source, "bad-skill", "SKILL.md"), "no frontmatter");
    const result = await runIsolatedGenerator({
      kind: "dogfood-skills",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-dogfood"),
    });
    assertEquals(result.success, false);
    assertEquals(result.errors, ["bad-skill: invalid_frontmatter"]);
  });
});

Deno.test("ste100 isolated overlay: treatment folders are copied through the overlay kind and returned as generated folders", async () => {
  await withTempRoot(async (root) => {
    const source = join(root, "treatments");
    await writeSkillFolder(source, "treated-skill", { "exaix.yaml": "title: Treated\n" });
    const result = await runIsolatedGenerator({
      kind: "overlay",
      root,
      sourceDir: source,
      targetDir: join(root, "arm-overlay"),
    });
    assertEquals(result.errors, []);
    assertEquals(result.generated, [join(root, "arm-overlay", "treated-skill")]);
    assertEquals(
      await Deno.readTextFile(join(root, "arm-overlay", "treated-skill", "exaix.yaml")),
      await Deno.readTextFile(join(source, "treated-skill", "exaix.yaml")),
    );
  });
});
