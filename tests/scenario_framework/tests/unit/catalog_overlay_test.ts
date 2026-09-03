/**
 * @module ScenarioFrameworkCatalogOverlayTest
 * @path tests/scenario_framework/tests/unit/catalog_overlay_test.ts
 * @description Tests for the catalog overlay mechanism (Phase 158 Step 2, closes GAP-1):
 * a `skill-version` or `identity-config` arm shadows one shipped catalog entry for the
 * run without editing `Blueprints/`. Skills are resolved against `Memory/Skills/` (the
 * tree `SkillsService` actually reads, generated from `Blueprints/Skills/*.skill.md` by
 * `scripts/build_skills_index.ts`), not `Blueprints/Skills/` itself. Agent roles are
 * resolved directly against `Blueprints/Agents/`, since `BlueprintResolver` reads
 * that tree without an intermediate build step.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/request/src/blueprint_resolver.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR } from "@exaix/request";

/** Runs `fn` with an env var set, always restoring the prior value. */
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

Deno.test("[CatalogOverlay] a skill overlay shadows the shipped skill's content for getSkill", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayDir = await Deno.makeTempDir({ prefix: "skill-overlay-" });
  try {
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await service.initialize();
    await service.createSkill({
      skill_id: "tdd-methodology",
      name: "TDD Methodology",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "shipped version",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["tdd"], task_types: ["testing"] },
      instructions: "shipped instructions",
    });

    await Deno.writeTextFile(
      join(overlayDir, "tdd-methodology.json"),
      JSON.stringify({
        id: "overlay-id",
        skill_id: "tdd-methodology",
        name: "TDD Methodology (overlay)",
        version: "2.0.0",
        description: "overlay version",
        scope: MemoryScope.GLOBAL,
        status: SkillStatus.ACTIVE,
        source: MemoryBankSource.USER,
        triggers: { keywords: ["tdd"], task_types: ["testing"] },
        instructions: "overlay instructions",
        created_at: new Date().toISOString(),
        usage_count: 0,
      }),
    );

    await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const overlaid = await service.getSkill("tdd-methodology");
      assertExists(overlaid);
      assertEquals(overlaid.instructions, "overlay instructions");
    });

    // For a run without the overlay env var, the shipped content is unaffected.
    const shipped = await service.getSkill("tdd-methodology");
    assertExists(shipped);
    assertEquals(shipped.instructions, "shipped instructions");
  } finally {
    await Deno.remove(overlayDir, { recursive: true });
    await cleanup();
  }
});

Deno.test("[CatalogOverlay] a skill with no overlay file falls back to the shipped catalog", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayDir = await Deno.makeTempDir({ prefix: "skill-overlay-empty-" });
  try {
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await service.initialize();
    await service.createSkill({
      skill_id: "error-handling",
      name: "Error Handling",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "shipped",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["error"], task_types: ["testing"] },
      instructions: "shipped instructions",
    });

    await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const result = await service.getSkill("error-handling");
      assertExists(result);
      assertEquals(result.instructions, "shipped instructions");
    });
  } finally {
    await Deno.remove(overlayDir, { recursive: true });
    await cleanup();
  }
});

Deno.test("[CatalogOverlay] an identity overlay shadows the shipped identity's content for BlueprintResolver.resolve", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "identity-overlay-" });
  const overlayRoot = await Deno.makeTempDir({ prefix: "identity-overlay-dir-" });
  const overlayDir = join(overlayRoot, "Agents");
  const mockLogger = createMockEventLogger();
  try {
    const blueprintsPath = join(testDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprintsPath, { recursive: true });
    await Deno.mkdir(overlayDir, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(blueprintsPath, "test-agent.md"), shippedBlueprint);
    await Deno.writeTextFile(
      join(overlayDir, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Test Agent (overlay)"'),
    );

    const resolver = new BlueprintResolver({ blueprintsPath });

    await withEnv(EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const loaded = await resolver.resolve("test-agent", mockLogger);
      assertExists(loaded);
      assertEquals(loaded.identityId, "test-agent");
      assertEquals(
        loaded.name,
        "Test Agent (overlay)",
        "the overlay's content must be what loads, not the shipped one",
      );
    });

    // Without the overlay env var, the shipped content is unaffected.
    const shipped = await resolver.resolve("test-agent", mockLogger);
    assertExists(shipped);
    assertEquals(shipped.name, "Test Agent");
  } finally {
    await Deno.remove(testDir, { recursive: true });
    await Deno.remove(overlayRoot, { recursive: true });
  }
});

Deno.test("[CatalogOverlay] an identity with no overlay file falls back to the shipped catalog", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "identity-overlay-fallback-" });
  const overlayRoot = await Deno.makeTempDir({ prefix: "identity-overlay-dir-empty-" });
  const overlayDir = join(overlayRoot, "Agents");
  const mockLogger = createMockEventLogger();
  try {
    const blueprintsPath = join(testDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprintsPath, { recursive: true });
    await Deno.mkdir(overlayDir, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(blueprintsPath, "test-agent.md"), shippedBlueprint);

    const resolver = new BlueprintResolver({ blueprintsPath });

    await withEnv(EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const loaded = await resolver.resolve("test-agent", mockLogger);
      assertExists(loaded);
      assertEquals(loaded.identityId, "test-agent");
      assertEquals(loaded.name, "Test Agent");
    });
  } finally {
    await Deno.remove(testDir, { recursive: true });
    await Deno.remove(overlayRoot, { recursive: true });
  }
});
