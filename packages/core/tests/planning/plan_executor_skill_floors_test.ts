/**
 * @module PlanExecutorSkillFloorsTest
 * @path packages/core/tests/planning/plan_executor_skill_floors_test.ts
 * @description The execution path's skill floors come from the plan's pinned skills, so a request
 *   that pinned a floor-bearing skill resolves the same floor during step execution that plan
 *   generation applied, even when the skill's triggers never match the request subject. A plan
 *   without pins applies no floor when nothing matches dynamically.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_composer.ts]
 */

import { assertEquals } from "@std/assert";
import {
  createMockConfig,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  runtimeSkillFixture,
  StubSkillsService,
} from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import {
  MemoryBankSource,
  PricingTier,
  ProviderCostTier,
  SkillMatchSource,
  SkillRenderOutcome,
  SkillRootKind,
} from "@exaix/core";
import type { IPinnedSkill, ISkillPin } from "@exaix/core/skills";
import type { IApplicationContext, ISkillsService } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import type { ISkill } from "@exaix/schemas";
import { PlanExecutor } from "../../src/planning/mod.ts";

const FLOOR_SKILL_ID = "response-contract-security-analysis";

const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "STATUS: COMPLETE\nSUMMARY: done",
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
  return runtimeSkillFixture({
    skill_id: skillId,
    title: "Response Contract Security Analysis",
    description: "Security review of the agent response contract.",
    instructions: "Review response contracts for injection and channeling risks.",
    source: MemoryBankSource.CORE,
    effort: "medium",
    critical: true,
    triggers: { keywords: [], task_types: [], tags: [] },
  });
}

/** Stub SkillsService: declares one floor-bearing skill, no dynamic matches. */
function createFloorSkillsService(): { service: ISkillsService; resolvedPins: string[] } {
  const resolvedPins: string[] = [];
  class FloorSkillsService extends StubSkillsService {
    override getSkill(skillId: string): Promise<ISkill | null> {
      return Promise.resolve(skillId === FLOOR_SKILL_ID ? floorSkill(skillId) : null);
    }
    override resolvePinned(pins: readonly ISkillPin[]): Promise<IPinnedSkill[]> {
      return Promise.resolve(pins.map((pin) => {
        resolvedPins.push(pin.name);
        return {
          pin,
          loaded: {
            skill: floorSkill(pin.name),
            revisionId: pin.revision_id,
            contentSha256: pin.content_sha256,
            rootKind: pin.root_kind,
            sourcePath: pin.source_path,
            snapshot: { skill_md: "", exaix_yaml: null, references: [] },
          },
        };
      }));
    }
  }
  return { service: new FloorSkillsService(), resolvedPins };
}

const FLOOR_PIN: ISkillPin = {
  name: FLOOR_SKILL_ID,
  revision_id: "0f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21",
  content_sha256: "a".repeat(64),
  root_kind: SkillRootKind.BLUEPRINT,
  source_path: FLOOR_SKILL_ID,
  portal: null,
  match_source: SkillMatchSource.PINNED,
  confidence: 1,
  matched_task_types: [],
  required: true,
  render_mode: SkillRenderOutcome.FULL,
  content_included: true,
};

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

    const { service: skills, resolvedPins } = createFloorSkillsService();

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
        resolved_skills: [FLOOR_PIN] as never,
      },
      steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
    });

    assertEquals(
      resolvedPins.includes("response-contract-security-analysis"),
      true,
      "resolvePinned must be consulted for the persisted resolved_skills",
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

Deno.test("PlanExecutor: no resolved_skills means no pinned skill floor is applied", async () => {
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
