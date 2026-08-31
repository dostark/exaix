/**
 * @module ScenarioFrameworkCatalogImmutabilityTest
 * @path tests/scenario_framework/tests/unit/catalog_immutability_test.ts
 * @description Verifies Phase 158 Step 2's arm mechanisms never mutate the catalog trees
 * they read from — a run leaves `Blueprints/Skills/`, `Memory/Skills/` and
 * `Blueprints/Identities/` byte-identical, not `Blueprints/` alone (the trees an arm
 * could plausibly touch, per the corrected Design Decision — see Pre-Gap Analysis
 * GAP-1). Exercises skill overlay and identity overlay, the two mechanisms that
 * actually read from a catalog tree; skill suppression is excluded here because it is a
 * pure in-memory filter over `AgentRunner`'s resolved set with zero file-system
 * interaction, so it has nothing to prove immutable. Each overlay call's result is
 * asserted, not just the tree snapshot, so this test cannot pass by both mechanisms
 * silently failing to do anything.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/request/src/blueprint_resolver.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { walk } from "@std/fs";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR } from "@exaix/request";

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get(name);
  try {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
    return await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
}

/** A deterministic snapshot of every file's relative path + content under `dir`. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  for await (const entry of walk(dir, { includeDirs: false })) {
    snapshot.set(entry.path.slice(dir.length), await Deno.readTextFile(entry.path));
  }
  return snapshot;
}

function assertTreesEqual(before: Map<string, string>, after: Map<string, string>, label: string): void {
  assertEquals([...after.keys()].sort(), [...before.keys()].sort(), `${label}: no files added or removed`);
  for (const [path, content] of before) {
    assertEquals(after.get(path), content, `${label}: ${path} is byte-identical`);
  }
}

Deno.test("[CatalogImmutability] Memory/Skills/ and Blueprints/Identities/ are byte-identical after skill and identity overlays run", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const skillsDir = join(config.system.root, config.paths.memory, "Skills");
  const identitiesRoot = await Deno.makeTempDir({ prefix: "immutability-identities-" });
  const identitiesDir = join(identitiesRoot, "Identities");
  const skillOverlayDir = await Deno.makeTempDir({ prefix: "immutability-skill-overlay-" });
  const identityOverlayRoot = await Deno.makeTempDir({ prefix: "immutability-identity-overlay-" });
  const identityOverlayDir = join(identityOverlayRoot, "Identities");
  const mockLogger = createMockEventLogger();

  try {
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await service.initialize();
    await service.createSkill({
      skill_id: "tdd-methodology",
      name: "TDD Methodology",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "shipped",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["tdd"], task_types: ["testing"] },
      instructions: "shipped instructions",
    });

    await Deno.mkdir(identitiesDir, { recursive: true });
    await Deno.mkdir(identityOverlayDir, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(identitiesDir, "test-agent.md"), shippedBlueprint);
    const resolver = new BlueprintResolver({ blueprintsPath: identitiesDir });

    await Deno.writeTextFile(
      join(skillOverlayDir, "tdd-methodology.json"),
      JSON.stringify({
        id: "overlay-id",
        skill_id: "tdd-methodology",
        name: "overlay",
        version: "2.0.0",
        description: "overlay",
        scope: MemoryScope.GLOBAL,
        status: SkillStatus.ACTIVE,
        source: MemoryBankSource.USER,
        triggers: { keywords: ["tdd"], task_types: ["testing"] },
        instructions: "overlay instructions",
        created_at: new Date().toISOString(),
        usage_count: 0,
      }),
    );
    await Deno.writeTextFile(
      join(identityOverlayDir, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Test Agent (overlay)"'),
    );

    const skillsBefore = await snapshotTree(skillsDir);
    const identitiesBefore = await snapshotTree(identitiesDir);

    // Exercise both mechanisms that touch a catalog tree, asserting each actually returned
    // the overlay content — a silently-broken overlay would leave the trees unmutated too,
    // which would make this test pass for the wrong reason.
    const overlaidSkill = await withEnv(
      EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR,
      skillOverlayDir,
      () => service.getSkill("tdd-methodology"),
    );
    assertExists(overlaidSkill);
    assertEquals(overlaidSkill.instructions, "overlay instructions");

    const overlaidIdentity = await withEnv(
      EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR,
      identityOverlayDir,
      () => resolver.resolve("test-agent", mockLogger),
    );
    assertExists(overlaidIdentity);
    assertEquals(overlaidIdentity.name, "Test Agent (overlay)");

    const skillsAfter = await snapshotTree(skillsDir);
    const identitiesAfter = await snapshotTree(identitiesDir);

    assertTreesEqual(skillsBefore, skillsAfter, "Memory/Skills/");
    assertTreesEqual(identitiesBefore, identitiesAfter, "Blueprints/Identities/");
  } finally {
    await Deno.remove(identitiesRoot, { recursive: true });
    await Deno.remove(skillOverlayDir, { recursive: true });
    await Deno.remove(identityOverlayRoot, { recursive: true });
    await cleanup();
  }
});
