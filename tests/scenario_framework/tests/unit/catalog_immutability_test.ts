/**
 * @module ScenarioFrameworkCatalogImmutabilityTest
 * @path tests/scenario_framework/tests/unit/catalog_immutability_test.ts
 * @description Verifies Phase 158 Step 2's arm mechanisms never mutate the catalog trees
 * they read from — a run leaves `Blueprints/Skills/`, `Memory/Skills/` and
 * `Blueprints/Agents/` byte-identical, not `Blueprints/` alone (the trees an arm
 * could plausibly touch, per the corrected Design Decision — see Pre-Gap Analysis
 * GAP-1). Exercises skill overlay and agent-role overlay, the two mechanisms that
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
import { BlueprintResolver, EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";

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

Deno.test("[CatalogImmutability] Memory/Skills/ and Blueprints/Agents/ are byte-identical after skill and agent-role overlays run", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const skillsDir = join(config.system.root, config.paths.memory, "Skills");
  const agentRolesRoot = await Deno.makeTempDir({ prefix: "immutability-agent-roles-" });
  const agentRolesDir = join(agentRolesRoot, "Agents");
  const skillOverlayDir = await Deno.makeTempDir({ prefix: "immutability-skill-overlay-" });
  const agentRoleOverlayRoot = await Deno.makeTempDir({ prefix: "immutability-agent-role-overlay-" });
  const agentRoleOverlayDir = join(agentRoleOverlayRoot, "Agents");
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

    await Deno.mkdir(agentRolesDir, { recursive: true });
    await Deno.mkdir(agentRoleOverlayDir, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(agentRolesDir, "test-agent.md"), shippedBlueprint);
    const resolver = new BlueprintResolver({ blueprintsPath: agentRolesDir });

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
      join(agentRoleOverlayDir, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Test Agent (overlay)"'),
    );

    const skillsBefore = await snapshotTree(skillsDir);
    const agentRolesBefore = await snapshotTree(agentRolesDir);

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

    const overlaidAgentRole = await withEnv(
      EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR,
      agentRoleOverlayDir,
      () => resolver.resolve("test-agent", mockLogger),
    );
    assertExists(overlaidAgentRole);
    assertEquals(overlaidAgentRole.name, "Test Agent (overlay)");

    const skillsAfter = await snapshotTree(skillsDir);
    const agentRolesAfter = await snapshotTree(agentRolesDir);

    assertTreesEqual(skillsBefore, skillsAfter, "Memory/Skills/");
    assertTreesEqual(agentRolesBefore, agentRolesAfter, "Blueprints/Agents/");
  } finally {
    await Deno.remove(agentRolesRoot, { recursive: true });
    await Deno.remove(skillOverlayDir, { recursive: true });
    await Deno.remove(agentRoleOverlayRoot, { recursive: true });
    await cleanup();
  }
});
