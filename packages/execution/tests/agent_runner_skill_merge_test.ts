// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentRunnerSkillMergeTest
 * @path packages/execution/tests/agent_runner_skill_merge_test.ts
 * @description Phase 122 Step 2 — verifies the agent_runner merges identity
 *   default_skills with explicit request.skills (GAP-5 fix).
 * @architectural-layer Unit
 * @dependencies [@exaix/execution]
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { AgentRunner, IAgentRunner } from "@exaix/execution";
import type { IBlueprint } from "@exaix/execution";

function makeMockProvider() {
  let callCount = 0;
  return {
    generate: () => {
      callCount++;
      return Promise.resolve({
        content: "{}",
        toolCalls: [] as any[],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock",
        provider: "mock",
      });
    },
    stream: () => Promise.reject(new Error("not implemented")),
    getModelInfo: () => ({ provider: "mock", model: "mock" }),
    name: "mock",
  };
}

function makeMockSkillsService() {
  return {
    recordSkillUsage: () => Promise.resolve(),
    matchSkills: () => Promise.resolve({ matches: [], totalAvailable: 0 }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (_id: string) => Promise.resolve(null),
    initialize: () => Promise.resolve(),
  };
}

function createMinimalRunner(): IAgentRunner {
  const provider = makeMockProvider();
  const skillsSvc = makeMockSkillsService();
  const runner = new AgentRunner(provider as any, {
    skillsService: skillsSvc,
    disableSkills: false,
  } as any);
  return runner;
}

Deno.test("[agent-runner-merge] default_skills union into resolved set when request.skills is set", async () => {
  const runner = createMinimalRunner();

  const blueprint: IBlueprint = {
    systemPrompt: "test",
    defaultSkills: ["tdd-methodology", "exaix-conventions", "portal-grounding", "security-first", "code-review"],
  };

  const request = {
    skills: ["exaix-conventions"],
    userPrompt: "implement feature",
    taskType: "feature",
  };

  const result = await (runner as any).matchAndApplySkills(
    blueprint,
    request,
    "test-identity",
  );

  assertExists(result);
  const resolved: string[] = result.skillIds;

  // Must contain the explicit request skill
  assertEquals(resolved.includes("exaix-conventions"), true);

  // Must ALSO contain all 5 default_skills from the identity
  const rigorSkills = ["tdd-methodology", "exaix-conventions", "portal-grounding", "security-first", "code-review"];
  for (const skill of rigorSkills) {
    assertEquals(resolved.includes(skill), true, `resolved set must include '${skill}'`);
  }
});

Deno.test("[agent-runner-merge] skipSkills still removes a skill from the unioned set", async () => {
  const runner = createMinimalRunner();

  const blueprint: IBlueprint = {
    systemPrompt: "test",
    defaultSkills: ["tdd-methodology", "exaix-conventions", "portal-grounding", "security-first", "code-review"],
  };

  const request = {
    skills: ["exaix-conventions"],
    skipSkills: ["code-review"],
    userPrompt: "implement feature",
    taskType: "feature",
  };

  const result = await (runner as any).matchAndApplySkills(
    blueprint,
    request,
    "test-identity",
  );

  assertExists(result);
  const resolved: string[] = result.skillIds;

  // The skipped skill must be removed
  assertEquals(resolved.includes("code-review"), false, "code-review must be skipped");

  // Other rigor skills must still be present
  assertEquals(resolved.includes("tdd-methodology"), true);
  assertEquals(resolved.includes("portal-grounding"), true);
  assertEquals(resolved.includes("security-first"), true);
});
