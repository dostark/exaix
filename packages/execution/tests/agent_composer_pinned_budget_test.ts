/**
 * @module AgentComposerPinnedBudgetTest
 * @path packages/execution/tests/agent_composer_pinned_budget_test.ts
 * @description A plan step with pinned skills reserves a skills section in the step's prompt budget. Without
 *   pins the section stays empty, so the budget is not spent on content that is absent. The strategy sees the
 *   section while the pinned prompt is rendered.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_composer.ts, packages/core/src/prompt_budget_allocator.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { AgentComposer, ExecutionContextService, StrategyRegistry } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode, SkillMatchSource, SkillRenderOutcome } from "@exaix/core";
import { buildSkillPin, createSkillOperationContext, type ISkillPin, SkillsService } from "@exaix/core/skills";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";

const SKILL = "budgeted-skill";
const BODY = "Budgeted skill body.";

async function run(withPin: boolean) {
  const { db, cleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "ac-pinned-budget-" });
  try {
    await Deno.mkdir(join(testDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(testDir, "Blueprints", "Agents", "test-agent.md"),
      "---\nagent_role: test-agent\nname: Test\nmodel: mock:test\n---\nYou are a test agent.\n",
    );
    const skillsDir = join(testDir, "Blueprints", "Skills");
    await writeSkillFolder(skillsDir, { name: SKILL, instructions: BODY });
    const skills = new SkillsService(
      { memoryDir: join(testDir, "Memory"), blueprintSkillsDir: skillsDir },
      db,
      undefined,
      new EventLogger({ db }),
    );
    await skills.initialize();
    const operation = createSkillOperationContext({ agentRole: "test-agent", portal: null });
    const skill = (await skills.getSkill(SKILL, operation))!;
    await skills.ensureRevisions([skill.id], operation);
    const pin: ISkillPin = buildSkillPin(
      {
        skillId: skill.skill_id,
        revisionId: skill.id,
        contentSha256: skill.content_sha256,
        rootKind: skill.root_kind,
        sourcePath: skill.path,
        source: SkillMatchSource.PINNED,
        confidence: 1,
        matchedTriggers: {},
        critical: false,
      },
      { portal: null, renderMode: SkillRenderOutcome.FULL, contentIncluded: true },
    );

    const config = createTestConfig();
    config.system.root = testDir;
    config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;
    const logger = new EventLogger({ db });
    const executionContext = new ExecutionContextService(config, logger, {});
    const seen: { skillsSection?: number; text?: string } = {};
    const strategy = {
      name: ExecutionStrategyName.REACT,
      execute: (
        _blueprint: IAgentFileBlueprint,
        _context: IExecutionContext,
        _options: IAgentExecutionOptions,
        pinned?: { text: string },
      ) => {
        seen.skillsSection = executionContext.currentPromptBudget?.sections.skills;
        seen.text = pinned?.text;
        return Promise.resolve({
          branch: "feat/budget",
          commit_sha: "0".repeat(40),
          files_changed: [],
          description: "Done",
          tool_calls: 0,
          execution_time_ms: 1,
        } as IChangesetResult);
      },
    };
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register(strategy as never);
    const composer = new AgentComposer({
      config,
      db,
      logger,
      pathResolver: new PathResolver(config),
      permissions: new PortalPermissionsService(config.portals as never),
      strategyRegistry,
      executionContext,
      skills,
    });
    try {
      await composer.executeStep(
        {
          trace_id: crypto.randomUUID(),
          request_id: "budget-req",
          request: "Do it",
          plan: "Do it",
          portal: "TestPortal",
          ...(withPin ? { resolved_skills: [pin] } : {}),
        } as never,
        {
          portal: "TestPortal",
          agent_role: "test-agent",
          security_mode: SecurityMode.HYBRID,
          timeout_ms: 30000,
          max_tool_calls: 5,
          audit_enabled: true,
          ...(withPin ? { resolved_skills: [pin] } : {}),
        } as IAgentExecutionOptions,
      );
    } finally {
      composer.dispose();
    }
    return seen;
  } finally {
    await Deno.remove(testDir, { recursive: true }).catch(() => {});
    await cleanup();
  }
}

Deno.test("[composer budget] pinned skills reserve a skills section that fits their rendered text", async () => {
  const seen = await run(true);
  assert(seen.text?.includes(BODY), "the strategy receives the pinned prompt");
  assert((seen.skillsSection ?? 0) > 0, `the skills section must be reserved, saw ${seen.skillsSection}`);
});

Deno.test("[composer budget] a step without pins reserves no skills section", async () => {
  const seen = await run(false);
  assertEquals(seen.text, undefined);
  assertEquals(seen.skillsSection, 0);
});
