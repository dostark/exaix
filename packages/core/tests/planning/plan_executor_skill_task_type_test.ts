/**
 * @module PlanExecutorSkillTaskTypeTest
 * @path packages/core/tests/planning/plan_executor_skill_task_type_test.ts
 * @description Phase 135 Reachability Ledger — `IAgentOrchestratorOptions.topSkillTaskTypes`
 *   was previously never populated by any production caller: resolveModelFromBlueprint
 *   read `this.options?.topSkillTaskTypes` (agent_orchestrator.ts), but nothing set it. Proves
 *   PlanExecutor.createAgentExecutor now calls the application context's SkillsService
 *   (already threaded through IPlanExecutorOptions.context) with the plan's originating
 *   request subject, and maps the top skill match's task_types into topSkillTaskTypes —
 *   making the skill-trigger tier of deriveTaskType's precedence chain reachable.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_orchestrator.ts, packages/execution/src/task_type_derivation.ts]
 */

import { assertEquals } from "@std/assert";
import { createMockConfig, createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { IApplicationContext, ISkillMatchRequest, ISkillsService } from "@exaix/core/types";
import type { ISkillMatch } from "@exaix/schemas";
import { PlanExecutor } from "../../src/planning/mod.ts";
import type { JSONValue } from "@exaix/core/types";

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

/** Stub SkillsService: records the request it was called with, returns one fixed match. */
function createRecordingSkillsService(
  match: ISkillMatch,
): { service: ISkillsService; calls: ISkillMatchRequest[] } {
  const calls: ISkillMatchRequest[] = [];
  const service: ISkillsService = {
    matchSkills: (request: ISkillMatchRequest) => {
      calls.push(request);
      return Promise.resolve({ matches: [match], totalAvailable: 1 });
    },
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
    getSkill: () => Promise.resolve(null),
    deleteSkill: () => Promise.resolve(false),
  };
  return { service, calls };
}

Deno.test({
  name: "PlanExecutor's AgentOrchestrator derives task_type from the top skill match (topSkillTaskTypes wiring)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const root = await Deno.makeTempDir();
      await Deno.mkdir(`${root}/Blueprints/Identities`, { recursive: true });
      // No frontmatter task_type/characteristics on the identity — precedence must fall
      // through frontmatter/identity tiers to reach the skill-trigger tier.
      await Deno.writeTextFile(
        `${root}/Blueprints/Identities/senior-coder.md`,
        '---\nidentity_id: senior-coder\nmodel: ""\n---\n\nStub identity for testing.\n',
      );
      const config = createMockConfig(root, {});
      const logger = createMockEventLogger();
      const resolver = new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        config,
        createStubHealthChecker(),
        logger,
      );

      const { service: skills, calls } = createRecordingSkillsService({
        skillId: "security-review",
        confidence: 0.9,
        matchedTriggers: { task_types: ["security"] },
      });

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
        request_id: "test-req",
        identity: "senior-coder",
        frontmatter: { subject: "Review this code for security issues" },
        steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
      });

      assertEquals(calls.length > 0, true, "matchSkills must be called during plan execution");
      assertEquals(
        calls[0].requestText,
        "Review this code for security issues",
        "matchSkills must be called with the plan's originating request subject",
      );

      const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
      assertEquals(resolvedEvents.length > 0, true, "ModelResolver.resolve() must have been called");
      const payload = resolvedEvents[0].payload as Record<string, JSONValue>;
      const intent = payload.intent as Record<string, JSONValue>;
      assertEquals(
        intent.task_type,
        "security",
        "the derived task_type must come from the top skill match's task_types",
      );
      assertEquals(intent.task_type_source, "skill");
    } finally {
      ProviderRegistry.clear();
    }
  },
});
