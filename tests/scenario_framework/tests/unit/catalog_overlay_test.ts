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

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";
import { produceSkillFolderOverlay } from "../../runner/skill_folder_overlay.ts";

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

async function fingerprint(dir: string): Promise<string[]> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) entries.push(...(await fingerprint(path)).map((rel) => `${entry.name}/${rel}`));
    else entries.push(`${entry.name}:${await Deno.readTextFile(path)}`);
  }
  return entries.sort();
}

Deno.test("[CatalogOverlay] the producer copies treatment folders into an exclusive root that changes resolution and leaves the shipped catalog untouched", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "skill-overlay-producer-" });
  try {
    const shipped = join(base, "shipped");
    const treatments = join(base, "treatments");
    await writeSkillFolder(shipped, "tdd-methodology", "shipped version", "shipped instructions");
    await writeSkillFolder(treatments, "tdd-methodology", "treated version", "treated instructions");
    await Deno.writeTextFile(
      join(treatments, "tdd-methodology", "exaix.yaml"),
      "triggers:\n  keywords: [treatmentword]\n",
    );
    const shippedBefore = await fingerprint(shipped);

    const overlay = await produceSkillFolderOverlay({
      root: base,
      sourceDir: treatments,
      targetDir: join(base, "arm-overlay"),
    });
    assertEquals(overlay.skills, ["tdd-methodology"]);
    assertEquals(overlay.overlayDir, join(base, "arm-overlay"));

    const service = new SkillsService({
      memoryDir: join(config.system.root, config.paths.memory),
      blueprintSkillsDir: shipped,
    }, db);
    await service.initialize();
    await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlay.overlayDir, async () => {
      assertEquals((await service.getSkill("tdd-methodology"))?.instructions, "treated instructions");
      const matches = await service.matchSkills({ keywords: ["treatmentword"] });
      assertEquals(matches.matches.map((match) => match.skillId), ["tdd-methodology"]);
    });
    assertEquals((await service.getSkill("tdd-methodology"))?.instructions, "shipped instructions");
    assertEquals(await fingerprint(shipped), shippedBefore);
  } finally {
    await Deno.remove(base, { recursive: true });
    await cleanup();
  }
});

Deno.test("[CatalogOverlay] a treatment that fails validation leaves no staged overlay behind", async () => {
  const base = await Deno.makeTempDir({ prefix: "skill-overlay-cleanup-" });
  try {
    const treatments = join(base, "treatments");
    await writeSkillFolder(treatments, "good-treatment", "good", "good body");
    await Deno.mkdir(join(treatments, "broken-treatment"), { recursive: true });
    await Deno.writeTextFile(join(treatments, "broken-treatment", "SKILL.md"), "no frontmatter");
    await assertRejects(
      () => produceSkillFolderOverlay({ root: base, sourceDir: treatments, targetDir: join(base, "arm-overlay") }),
      Error,
      "broken-treatment: invalid_frontmatter",
    );
    assertEquals(await exists(join(base, "arm-overlay")), false);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[CatalogOverlay] the producer refuses an existing target and a target outside the isolated root", async () => {
  const base = await Deno.makeTempDir({ prefix: "skill-overlay-target-" });
  try {
    const treatments = join(base, "treatments");
    await writeSkillFolder(treatments, "one-treatment", "one", "body");
    await Deno.mkdir(join(base, "taken"));
    await assertRejects(() =>
      produceSkillFolderOverlay({ root: base, sourceDir: treatments, targetDir: join(base, "taken") })
    );
    await assertRejects(() =>
      produceSkillFolderOverlay({ root: join(base, "taken"), sourceDir: treatments, targetDir: join(base, "outside") })
    );
    assertEquals(await exists(join(base, "outside")), false);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
