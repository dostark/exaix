/**
 * @module ScenarioFrameworkCatalogOverlayTest
 * @path tests/scenario_framework/tests/unit/catalog_overlay_test.ts
 * @description Tests for the catalog overlay mechanism (Phase 158 Step 2, closes GAP-1):
 * a `skill-version` or `agent-role-config` arm shadows one shipped catalog entry for the
 * run without editing `Blueprints/`. Skills are resolved as folders: the overlay
 * directory is a prepended `SkillsService` root of `<name>/SKILL.md` folders. Agent roles are
 * resolved directly against `Blueprints/Agents/`, since `BlueprintResolver` reads
 * that tree without an intermediate build step.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/request/src/blueprint_resolver.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";

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

/** Writes a skill folder with a body and optional sidecar into `root`. */
async function writeSkillFolder(root: string, name: string, description: string, body: string): Promise<void> {
  await Deno.mkdir(join(root, name), { recursive: true });
  await Deno.writeTextFile(
    join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
  );
}

Deno.test("[CatalogOverlay] a skill overlay shadows the shipped skill's content for getSkill", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayDir = await Deno.makeTempDir({ prefix: "skill-overlay-" });
  const shippedDir = await Deno.makeTempDir({ prefix: "skill-shipped-" });
  try {
    await writeSkillFolder(shippedDir, "tdd-methodology", "shipped version", "shipped instructions");
    const service = new SkillsService({
      memoryDir: join(config.system.root, config.paths.memory),
      blueprintSkillsDir: shippedDir,
    }, db);
    await service.initialize();
    await writeSkillFolder(overlayDir, "tdd-methodology", "overlay version", "overlay instructions");

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
    await Deno.remove(shippedDir, { recursive: true });
    await cleanup();
  }
});

Deno.test("[CatalogOverlay] a skill with no overlay folder falls back to the shipped catalog", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayDir = await Deno.makeTempDir({ prefix: "skill-overlay-empty-" });
  const shippedDir = await Deno.makeTempDir({ prefix: "skill-shipped-" });
  try {
    await writeSkillFolder(shippedDir, "error-handling", "shipped", "shipped instructions");
    const service = new SkillsService({
      memoryDir: join(config.system.root, config.paths.memory),
      blueprintSkillsDir: shippedDir,
    }, db);
    await service.initialize();

    await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const result = await service.getSkill("error-handling");
      assertExists(result);
      assertEquals(result.instructions, "shipped instructions");
    });
  } finally {
    await Deno.remove(overlayDir, { recursive: true });
    await Deno.remove(shippedDir, { recursive: true });
    await cleanup();
  }
});

Deno.test("[CatalogOverlay] an agent role overlay shadows the shipped agent role's content for BlueprintResolver.resolve", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "agent-role-overlay-" });
  const overlayRoot = await Deno.makeTempDir({ prefix: "agent-role-overlay-dir-" });
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

    await withEnv(EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const loaded = await resolver.resolve("test-agent", mockLogger);
      assertExists(loaded);
      assertEquals(loaded.agentRole, "test-agent");
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

Deno.test("[CatalogOverlay] an agent role with no overlay file falls back to the shipped catalog", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "agent-role-overlay-fallback-" });
  const overlayRoot = await Deno.makeTempDir({ prefix: "agent-role-overlay-dir-empty-" });
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

    await withEnv(EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR, overlayDir, async () => {
      const loaded = await resolver.resolve("test-agent", mockLogger);
      assertExists(loaded);
      assertEquals(loaded.agentRole, "test-agent");
      assertEquals(loaded.name, "Test Agent");
    });
  } finally {
    await Deno.remove(testDir, { recursive: true });
    await Deno.remove(overlayRoot, { recursive: true });
  }
});
