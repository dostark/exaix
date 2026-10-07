// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkArmIsolationTest
 * @path tests/scenario_framework/tests/unit/arm_isolation_test.ts
 * @description Verifies Phase 158 Step 2's env-scoped arm mechanisms (skill
 * suppression, skill overlay, agent-role overlay) never leak state between arms. The
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
import { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { BlueprintResolver, EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";
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
      forContext() {
        return this;
      },
      recordSubmission: () => Promise.resolve(),
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
    () => (runner as Any).matchAndApplySkills(blueprint, request, "test-role"),
  );
  assertEquals(armAResult.skillIds.includes("skill-x"), false, "arm A suppresses skill-x");

  const armBResult: { skillIds: string[] } = await withEnv(
    EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR,
    "skill-y",
    () => (runner as Any).matchAndApplySkills(blueprint, request, "test-role"),
  );
  assertEquals(armBResult.skillIds.includes("skill-x"), true, "arm B must not inherit arm A's suppression");
  assertEquals(armBResult.skillIds.includes("skill-y"), false, "arm B suppresses skill-y instead");
});

Deno.test("[ArmIsolation] two sequential skill overlays each see only their own content", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const overlayA = await Deno.makeTempDir({ prefix: "isolation-skill-overlay-a-" });
  const overlayB = await Deno.makeTempDir({ prefix: "isolation-skill-overlay-b-" });
  try {
    const shipped = await Deno.makeTempDir({ prefix: "isolation-skill-shipped-" });
    await writeSkillFolder(shipped, { name: "tdd-methodology", instructions: "shipped" });
    const service = new SkillsService({
      memoryDir: join(config.system.root, config.paths.memory),
      blueprintSkillsDir: shipped,
    }, db);
    await service.initialize();

    for (const [dir, marker] of [[overlayA, "content-A"], [overlayB, "content-B"]] as const) {
      await writeSkillFolder(dir, { name: "tdd-methodology", instructions: marker });
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

Deno.test("[ArmIsolation] two sequential agent role overlays each see only their own content", async () => {
  const agentRolesRoot = await Deno.makeTempDir({ prefix: "isolation-agent-roles-" });
  const agentRolesDir = join(agentRolesRoot, "Agents");
  const overlayARoot = await Deno.makeTempDir({ prefix: "isolation-agent-role-overlay-a-" });
  const overlayA = join(overlayARoot, "Agents");
  const overlayBRoot = await Deno.makeTempDir({ prefix: "isolation-agent-role-overlay-b-" });
  const overlayB = join(overlayBRoot, "Agents");
  const mockLogger = createMockEventLogger();
  try {
    await Deno.mkdir(agentRolesDir, { recursive: true });
    await Deno.mkdir(overlayA, { recursive: true });
    await Deno.mkdir(overlayB, { recursive: true });
    const shippedBlueprint = await Deno.readTextFile(
      new URL("../../../../packages/request/tests/fixtures/sample_blueprint.yaml", import.meta.url),
    );
    await Deno.writeTextFile(join(agentRolesDir, "test-agent.md"), shippedBlueprint);
    await Deno.writeTextFile(
      join(overlayA, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Arm A"'),
    );
    await Deno.writeTextFile(
      join(overlayB, "test-agent.md"),
      shippedBlueprint.replace('name: "Test Agent"', 'name: "Arm B"'),
    );
    const resolver = new BlueprintResolver({ blueprintsPath: agentRolesDir });

    const armA = await withEnv(
      EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR,
      overlayA,
      () => resolver.resolve("test-agent", mockLogger),
    );
    assertExists(armA);
    assertEquals(armA.name, "Arm A");

    const armB = await withEnv(
      EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR,
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
    await Deno.remove(agentRolesRoot, { recursive: true });
    await Deno.remove(overlayARoot, { recursive: true });
    await Deno.remove(overlayBRoot, { recursive: true });
  }
});
