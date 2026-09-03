// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkArmIsolationTest
 * @path tests/scenario_framework/tests/unit/arm_isolation_test.ts
 * @description Verifies Phase 158 Step 2's env-scoped arm mechanisms (skill
 * suppression, skill overlay, identity overlay) never leak state between arms. The
 * scenario framework runs one scenario per daemon process, so true concurrent access
 * to different env values within one process never happens in production — what a
 * same-process unit test CAN meaningfully prove is the honest proxy: two SEQUENTIAL
 * calls with different arm configurations never observe each other's configuration,
 * ruling out the real bug class this guards against (a value memoized at construction
 * or on first read instead of re-read per call).
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/request/src/blueprint_resolver.ts, packages/execution/src/agent_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR } from "@exaix/request";
import { AgentRunner, EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR } from "@exaix/execution";
import type { IBlueprint } from "@exaix/execution";

type Any = any;

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

Deno.test("[ArmIsolation] suppressing skill X for one arm does not suppress it for the next arm's call", async () => {
  function makeSkillsService() {
    return {
      recordSkillUsage: () => Promise.resolve(),
      matchSkills: () => Promise.resolve({ matches: [], totalAvailable: 0 }),
      buildSkillContext: () => Promise.resolve(""),
      getSkill: (id: string) =>
        Promise.resolve({ id, name: id, description: "", instructions: "", triggers: {} } as Any),
      initialize: () => Promise.resolve(),
    };
  }
  const runner = new AgentRunner({ generate: () => Promise.reject(new Error("unused")) } as Any, {
    skillsService: makeSkillsService(),
    disableSkills: false,
  } as Any);
  const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["skill-x", "skill-y"] };
  const request = { userPrompt: "do the thing", taskType: "feature" };

  const armAResult: { skillIds: string[] } = await withEnv(
    EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR,
    "skill-x",
    () => (runner as Any).matchAndApplySkills(blueprint, request, "test-identity"),
  );
  assertEquals(armAResult.skillIds.includes("skill-x"), false, "arm A suppresses skill-x");

  const armBResult: { skillIds: string[] } = await withEnv(
    EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR,
    "skill-y",
    () => (runner as Any).matchAndApplySkills(blueprint, request, "test-identity"),
  );
  assertEquals(armBResult.skillIds.includes("skill-x"), true, "arm B must not inherit arm A's suppression");
  assertEquals(armBResult.skillIds.includes("skill-y"), false, "arm B suppresses skill-y instead");
});

Deno.test("[ArmIsolation] two sequential skill overlays each see only their own content", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayA = await Deno.makeTempDir({ prefix: "isolation-skill-overlay-a-" });
  const overlayB = await Deno.makeTempDir({ prefix: "isolation-skill-overlay-b-" });
  try {
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await service.initialize();
    await service.createSkill({
      skill_id: "tdd-methodology",
      name: "TDD",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "shipped",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["tdd"], task_types: [] },
      instructions: "shipped",
    });

    for (const [dir, marker] of [[overlayA, "content-A"], [overlayB, "content-B"]] as const) {
      await Deno.writeTextFile(
        join(dir, "tdd-methodology.json"),
        JSON.stringify({
          id: marker,
          skill_id: "tdd-methodology",
          name: marker,
          version: "2.0.0",
          description: marker,
          scope: MemoryScope.GLOBAL,
          status: SkillStatus.ACTIVE,
          source: MemoryBankSource.USER,
          triggers: { keywords: ["tdd"], task_types: [] },
          instructions: marker,
          created_at: new Date().toISOString(),
          usage_count: 0,
        }),
      );
    }

    const armA = await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlayA, () => service.getSkill("tdd-methodology"));
    assertExists(armA);
    assertEquals(armA.instructions, "content-A");

    const armB = await withEnv(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, overlayB, () => service.getSkill("tdd-methodology"));
    assertExists(armB);
    assertEquals(armB.instructions, "content-B", "arm B must not observe arm A's overlay content");
  } finally {
    await Deno.remove(overlayA, { recursive: true });
    await Deno.remove(overlayB, { recursive: true });
    await cleanup();
  }
});

Deno.test("[ArmIsolation] two sequential identity overlays each see only their own content", async () => {
  // IBlueprintLoader.resolvePath treats a blueprintsPath NOT ending in "Identities" as a
  // Blueprints root and appends "Identities" itself — every path here must end in it.
  const identitiesRoot = await Deno.makeTempDir({ prefix: "isolation-identities-" });
  const identitiesDir = join(identitiesRoot, "Agents");
  const overlayARoot = await Deno.makeTempDir({ prefix: "isolation-identity-overlay-a-" });
  const overlayA = join(overlayARoot, "Agents");
  const overlayBRoot = await Deno.makeTempDir({ prefix: "isolation-identity-overlay-b-" });
  const overlayB = join(overlayBRoot, "Agents");
  const mockLogger = createMockEventLogger();
  try {
    await Deno.mkdir(identitiesDir, { recursive: true });
    await Deno.mkdir(overlayA, { recursive: true });
    await Deno.mkdir(overlayB, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(identitiesDir, "test-agent.md"), shippedBlueprint);
    await Deno.writeTextFile(
      join(overlayA, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Arm A"'),
    );
    await Deno.writeTextFile(
      join(overlayB, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Arm B"'),
    );
    const resolver = new BlueprintResolver({ blueprintsPath: identitiesDir });

    const armA = await withEnv(
      EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR,
      overlayA,
      () => resolver.resolve("test-agent", mockLogger),
    );
    assertExists(armA);
    assertEquals(armA.name, "Arm A");

    const armB = await withEnv(
      EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR,
      overlayB,
      () => resolver.resolve("test-agent", mockLogger),
    );
    assertExists(armB);
    assertEquals(armB.name, "Arm B", "arm B must not observe arm A's overlay content");

    // No overlay env set at all: falls back to the shipped catalog, proving neither
    // arm's env value was retained anywhere.
    const noOverlay = await resolver.resolve("test-agent", mockLogger);
    assertExists(noOverlay);
    assertEquals(noOverlay.name, "Test Agent");
  } finally {
    await Deno.remove(identitiesRoot, { recursive: true });
    await Deno.remove(overlayARoot, { recursive: true });
    await Deno.remove(overlayBRoot, { recursive: true });
  }
});
