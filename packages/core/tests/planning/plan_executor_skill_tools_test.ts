/**
 * @module PlanExecutorSkillToolsTest
 * @path packages/core/tests/planning/plan_executor_skill_tools_test.ts
 * @description Proves PlanExecutor.createAgentExecutor unions the `tools` declared by every
 *   matched skill and passes them as AgentOrchestrator's matchedSkillTools option, and that
 *   the union (intersected with the identity's permitted_tools) actually filters the
 *   execution prompt's tool list — mirroring plan_executor_skill_task_type_test.ts's proof
 *   for topSkillTaskTypes, but for the tools union+intersect wiring instead of task_type
 *   derivation.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_orchestrator.ts, packages/execution/src/skill_tools_derivation.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { createMockConfig, createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { IApplicationContext, ISkillsService } from "@exaix/core/types";
import type { ISkill, ISkillMatch } from "@exaix/schemas";
import { McpToolName, MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import { PlanExecutor } from "../../src/planning/mod.ts";

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

function makeSkill(skillId: string, tools: McpToolName[]): ISkill {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    skill_id: skillId,
    name: skillId,
    version: "1.0.0",
    description: skillId,
    triggers: {},
    instructions: "Test instructions for this skill.",
    tools,
    usage_count: 0,
  };
}

/** Stub SkillsService: returns two fixed matches, and resolves each match's full skill by id. */
function createMultiMatchSkillsService(
  matches: ISkillMatch[],
  skillsById: Record<string, ISkill>,
): ISkillsService {
  return {
    matchSkills: () => Promise.resolve({ matches, totalAvailable: matches.length }),
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
    getSkill: (skillId: string) => Promise.resolve(skillsById[skillId] ?? null),
    deleteSkill: () => Promise.resolve(false),
  };
}

Deno.test({
  name:
    "PlanExecutor's AgentOrchestrator unions matched skills' tools and filters the execution prompt (matchedSkillTools wiring)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const root = await Deno.makeTempDir();
      await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
      // Identity permits a BROAD set — list_directory is included here but no matched skill
      // declares it, so it must not survive the intersection.
      await Deno.writeTextFile(
        `${root}/Blueprints/Agents/senior-coder.md`,
        '---\nagent_role: senior-coder\nmodel: ""\n' +
          'permitted_tools: ["read_file", "write_file", "delete_file", "list_directory"]\n---\n\n' +
          "Stub identity for testing.\n",
      );
      const config = createMockConfig(root, {});
      const logger = createMockEventLogger();
      const resolver = new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        config,
        createStubHealthChecker(),
        logger,
      );

      // Two matched skills: fix-bug contributes read_file+write_file; git-workflow
      // contributes write_file+delete_file. Union = {read_file, write_file, delete_file}.
      const fixBugSkill = makeSkill("fix-bug", [McpToolName.READ_FILE, McpToolName.WRITE_FILE]);
      const gitWorkflowSkill = makeSkill("git-workflow", [McpToolName.WRITE_FILE, McpToolName.DELETE_FILE]);
      const skills = createMultiMatchSkillsService(
        [
          { skillId: "fix-bug", confidence: 0.9, matchedTriggers: {} },
          { skillId: "git-workflow", confidence: 0.6, matchedTriggers: {} },
        ],
        { "fix-bug": fixBugSkill, "git-workflow": gitWorkflowSkill },
      );

      const context: IApplicationContext = {
        config: createStubConfig(config),
        db: stubDb as never,
        provider: undefined as never,
        git: createStubGit(),
        display: createStubDisplay(stubDb as never),
        skills,
      };

      let capturedPrompt = "";
      const capturingProvider = {
        id: "stub",
        generate: (prompt: string) => {
          capturedPrompt = prompt;
          return Promise.resolve({
            content: `\`\`\`json\n${
              JSON.stringify({
                branch: "feat/x",
                commit_sha: "1234567890123456789012345678901234567890",
                files_changed: [],
                description: "done",
                tool_calls: 0,
                execution_time_ms: 1,
              })
            }\n\`\`\``,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: "stub",
            provider: "stub",
          });
        },
      };

      const executor = new PlanExecutor(
        config,
        capturingProvider as never,
        stubDb as never,
        root,
        logger,
        { modelResolver: resolver, enableGit: false, generateReport: false, context },
      );

      await executor.execute(`${root}/plan.md`, {
        trace_id: crypto.randomUUID(),
        request_id: "test-req",
        agent_role: "senior-coder",
        frontmatter: { subject: "Fix the null-safety bug and commit" },
        steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
      });

      assertStringIncludes(capturedPrompt, "read_file");
      assertStringIncludes(capturedPrompt, "write_file");
      assertStringIncludes(
        capturedPrompt,
        "delete_file",
        "delete_file is in both the skill-tools union and the identity's permitted_tools — must survive",
      );
      assertEquals(
        capturedPrompt.includes("list_directory"),
        false,
        "list_directory must be excluded: the identity permits it, but no matched skill's tools union includes it",
      );
    } finally {
      ProviderRegistry.clear();
    }
  },
});
