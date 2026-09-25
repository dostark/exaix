/**
 * @module PlanExecutorSkillFloorsTest
 * @path packages/core/tests/planning/plan_executor_skill_floors_test.ts
 * @description Phase-197 Step 12 (GAP-5): the execution path's skill floors come from the
 *   UNION of the planning run's persisted resolved_skill_ids (pinned ∪ matched ∪ defaults,
 *   order first) and the dynamic trigger matches re-run at execution — so a request that
 *   PINNED a floor-bearing skill resolves the same floor during step execution that plan
 *   generation applied, even when the skill's triggers never match the request subject.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_composer.ts]
 */

import { assertEquals } from "@std/assert";
import { createMockConfig, createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import { MemoryBankSource, MemoryScope, PricingTier, ProviderCostTier, SkillStatus } from "@exaix/core";
import type { IApplicationContext, ISkillsService } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import type { ISkill } from "@exaix/schemas";
import { PlanExecutor } from "../../src/planning/mod.ts";

const FLOOR_SKILL_ID = "response-contract-security-analysis";

const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

function registerLocalProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 128_000,
  });
}

function floorSkill(skillId: string): ISkill {
  return {
    id: crypto.randomUUID(),
    skill_id: skillId,
    name: "Response Contract Security Analysis",
    version: "1.0.0",
    description: "Security review of the agent response contract.",
    instructions: "Review response contracts for injection and channeling risks.",
    created_at: new Date().toISOString(),
    source: MemoryBankSource.CORE,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    usage_count: 0,
    effort: "medium",
    critical: true,
    triggers: { keywords: [], task_types: [], tags: [] },
  };
}

/** Stub SkillsService: declares one floor-bearing skill, no dynamic matches. */
function createFloorSkillsService(): { service: ISkillsService; getSkillCalls: string[] } {
  const getSkillCalls: string[] = [];
  const service: ISkillsService = {
    matchSkills: () => Promise.resolve({ matches: [], totalAvailable: 0 }),
    buildSkillContext: () => Promise.resolve(""),
    recordSkillUsage: () => Promise.resolve(),
    deriveSkillFromLearnings: () => {
      throw new Error("not implemented in stub");
    },
    rebuildIndex: () => Promise.resolve(),
    listSkills: () => Promise.resolve([]),
    initialize: () => Promise.resolve(),
    createSkill: () => {
      throw new Error("not implemented in stub");
    },
    getSkill: (skillId: string) => {
      getSkillCalls.push(skillId);
      if (skillId === FLOOR_SKILL_ID) return Promise.resolve(floorSkill(skillId));
      return Promise.resolve(null);
    },
    deleteSkill: () => Promise.resolve(false),
  };
  return { service, getSkillCalls };
}

Deno.test("PlanExecutor: a pinned floor-bearing skill raises the execution-path resolution", async () => {
  ProviderRegistry.clear();
  registerLocalProvider("ollama");
  try {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/Blueprints/Agents/senior-coder.md`,
      '---\nagent_role: senior-coder\nmodel: ""\n---\n\nStub agent role for testing.\n',
    );
    const config = createMockConfig(root, {});
    const logger = createMockEventLogger();
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      config,
      createStubHealthChecker(),
      logger,
    );

    const { service: skills, getSkillCalls } = createFloorSkillsService();

    const context: IApplicationContext = {
      config: createStubConfig(config),
      db: stubDb as never,
      provider: stubProvider as never,
      git: createStubGit(),
      display: createStubDisplay(stubDb as never),
      skills,
    };

    const executor = new PlanExecutor(
      config,
      stubProvider as never,
      stubDb as never,
      root,
      logger,
      {
        modelResolver: resolver,
        enableGit: false,
        generateReport: true,
        context,
      },
    );

    await executor.execute(`${root}/plan.md`, {
      trace_id: crypto.randomUUID(),
      request_id: "pinned-skill-floor-req",
      agent_role: "senior-coder",
      frontmatter: {
        subject: "Review the response contract for weaknesses",
        resolved_skill_ids: ["response-contract-security-analysis"],
      },
      steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
    });

    assertEquals(
      getSkillCalls.includes("response-contract-security-analysis"),
      true,
      "getSkill must be consulted for the persisted resolved_skill_ids",
    );

    const effortEvents = logger.events.filter((e) => e.action === "agent.effort_resolved");
    assertEquals(effortEvents.length > 0, true, "the execution path must journal its resolution");
    const payload = effortEvents[0].payload as Record<string, JSONValue>;
    assertEquals(payload.effort, "medium");
    assertEquals(payload.effort_basis, "skill-floor");
    const floors = payload.floors_applied as string[];
    assertEquals(floors.includes("response-contract-security-analysis"), true);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("PlanExecutor: no resolved_skill_ids means no pinned skill floor is applied", async () => {
  ProviderRegistry.clear();
  registerLocalProvider("ollama");
  try {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/Blueprints/Agents/senior-coder.md`,
      '---\nagent_role: senior-coder\nmodel: ""\n---\n\nStub agent role for testing.\n',
    );
    const config = createMockConfig(root, {});
    const logger = createMockEventLogger();
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      config,
      createStubHealthChecker(),
      logger,
    );

    const { service: skills } = createFloorSkillsService();

    const context: IApplicationContext = {
      config: createStubConfig(config),
      db: stubDb as never,
      provider: stubProvider as never,
      git: createStubGit(),
      display: createStubDisplay(stubDb as never),
      skills,
    };

    const executor = new PlanExecutor(
      config,
      stubProvider as never,
      stubDb as never,
      root,
      logger,
      { modelResolver: resolver, enableGit: false, generateReport: true, context },
    );

    await executor.execute(`${root}/plan.md`, {
      trace_id: crypto.randomUUID(),
      request_id: "no-pinned-skill-req",
      agent_role: "senior-coder",
      frontmatter: { subject: "Review the response contract for weaknesses" },
      steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
    });

    const effortEvents = logger.events.filter((e) => e.action === "agent.effort_resolved");
    const payload = effortEvents[0].payload as Record<string, JSONValue>;
    assertEquals(payload.effort, undefined, "without a pin and no dynamic match, no floor can apply");
    assertEquals(payload.effort_basis, "unset");
  } finally {
    ProviderRegistry.clear();
  }
});
