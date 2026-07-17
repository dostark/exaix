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
import { AgentRunner } from "@exaix/execution";
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

function makeMockSkillsServiceWithDynamicMatch(
  dynamicMatchSkillId: string,
  criticalSkillIds: Set<string>,
) {
  return {
    recordSkillUsage: () => Promise.resolve(),
    matchSkills: () =>
      Promise.resolve({
        matches: [{ skillId: dynamicMatchSkillId, confidence: 1.0, matchedTriggers: {} }],
        totalAvailable: 1,
      }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (id: string) =>
      Promise.resolve({
        id,
        name: id,
        description: "",
        instructions: "",
        triggers: {},
        critical: criticalSkillIds.has(id),
      } as any),
    initialize: () => Promise.resolve(),
  };
}

function createMinimalRunner(): AgentRunner {
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

Deno.test("fix(agent-runner): a critical default skill survives a successful dynamic match", async () => {
  // Regression for: matchAndApplySkills's dynamic-matching branch (no explicit
  // request.skills) never unioned in blueprint.defaultSkills at all, so a
  // critical:true skill like response-contract was silently dropped from the
  // prompt whenever dynamic matching found any match — previously masked only
  // because dynamic matching always returned zero matches (a separate, now-fixed
  // bug in SkillsService.scoreKeywordTriggers), which made the all-defaults
  // fallback branch fire on every real request.
  const provider = makeMockProvider();
  const skillsSvc = makeMockSkillsServiceWithDynamicMatch(
    "tdd-methodology",
    new Set(["response-contract"]),
  );
  const runner = new AgentRunner(provider as any, {
    skillsService: skillsSvc,
    disableSkills: false,
  } as any);

  const blueprint: IBlueprint = {
    systemPrompt: "test",
    defaultSkills: ["response-contract", "error-handling", "portal-grounding", "blueprint-best-practices"],
  };

  const request = {
    userPrompt: "Fix the null-safety bug in src/utils.ts",
    taskType: "bugfix",
  };

  const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");

  assertExists(result);
  const resolved: string[] = result.skillIds;

  // The dynamic match must still be present.
  assertEquals(resolved.includes("tdd-methodology"), true);

  // The critical default skill must survive even though it wasn't dynamically matched.
  assertEquals(resolved.includes("response-contract"), true, "critical default skill must not be dropped");

  // Non-critical defaults must NOT be pulled in — only the critical one, to avoid
  // reintroducing the prompt-bloat problem this fix is meant to prevent.
  assertEquals(resolved.includes("error-handling"), false);
  assertEquals(resolved.includes("portal-grounding"), false);
  assertEquals(resolved.includes("blueprint-best-practices"), false);
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
