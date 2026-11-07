/**
 * @module AgentComposerAdapterStrategySkillDeliveryTest
 * @path packages/flow/tests/agent_composer_adapter_strategy_skill_delivery_test.ts
 * @description Checks missing defaults, declared ordering and role-root rejection before flow skill pin submission.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_skill_pins.ts, packages/flow/src/agent_composer_adapter.ts]
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { createBlueprintLoader } from "@exaix/core/blueprint";
import { createNoopEventLogger } from "@exaix/core/logger";
import { createMockConfig, REPO_ROOT, runtimeSkillFixture, StubSkillsService, withTempDir } from "@exaix/testing";
import { prepareFlowSkillPins } from "../src/flow_skill_pins.ts";

Deno.test("flow skill selection resolves explicit IDs first and rejects a missing role default before persistence", async () => {
  const loader = createBlueprintLoader(join(REPO_ROOT, "Blueprints"));
  const blueprint = await loader.load("product-manager");
  assertExists(blueprint);
  const calls: string[] = [];
  const skills = new StubSkillsService();
  skills.getSkill = (name) => {
    calls.push(name);
    return Promise.resolve(name === "requirements-analysis" ? null : runtimeSkillFixture({ name, skill_id: name }));
  };
  skills.ensureRevisions = () => Promise.reject(new Error("Incomplete selections must not persist"));
  await assertRejects(
    () =>
      prepareFlowSkillPins({
        skills,
        blueprint,
        config: createMockConfig(REPO_ROOT),
        logger: createNoopEventLogger(),
        traceId: crypto.randomUUID(),
        request: {
          userPrompt: "Requirements",
          context: {},
          portal: "project",
          skills: ["typescript-patterns", "typescript-patterns"],
        },
      }),
    Error,
    "requirements-analysis",
  );
  assertEquals(calls, ["typescript-patterns", "response-contract", "requirements-analysis"]);
});

Deno.test("flow skill selection rejects mismatched role roots before resolving skills", async () => {
  await withTempDir(async (root) => {
    const loader = createBlueprintLoader(join(REPO_ROOT, "Blueprints"));
    const blueprint = await loader.load("product-manager");
    assertExists(blueprint);
    await copy(join(REPO_ROOT, "Blueprints/Agents"), join(root, "Blueprints/Agents"));
    const skills = new StubSkillsService();
    skills.getSkill = () => Promise.reject(new Error("Mismatched roles must not resolve skills"));
    await assertRejects(
      () =>
        prepareFlowSkillPins({
          skills,
          blueprint,
          config: createMockConfig(root),
          logger: createNoopEventLogger(),
          traceId: crypto.randomUUID(),
          request: { userPrompt: "Requirements", context: {}, portal: "project", skills: ["typescript-patterns"] },
        }),
      Error,
      "roots disagree",
    );
  });
});
