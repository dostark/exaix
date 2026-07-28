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

  // SUPERSEDED by Phase 142 Step 17: non-critical defaults ARE now pulled in. The
  // critical-only union was an anti-bloat measure that made the resulting set depend on a
  // flag only 2 of 27 skills set, so nobody could predict it. Bloat is now controlled by
  // keeping identity default_skills short instead, and every default is concatenated.
  assertEquals(resolved.includes("error-handling"), true);
  assertEquals(resolved.includes("portal-grounding"), true);
  assertEquals(resolved.includes("blueprint-best-practices"), true);
});

// ---------------------------------------------------------------------------
// Phase 142 Step 17 — always-concatenate. Skill resolution used three different
// merge rules depending on branch (explicit pin unioned ALL defaults, a dynamic
// hit unioned only `critical` ones, a dynamic miss took ALL defaults), so nobody
// could predict the resulting set. One rule now applies everywhere:
// pinned ∪ matched ∪ defaults.
// ---------------------------------------------------------------------------

Deno.test("[step17] explicit pin concatenates with every identity default", async () => {
  const runner = createMinimalRunner();
  const blueprint: IBlueprint = {
    systemPrompt: "test",
    defaultSkills: ["response-contract", "error-handling", "portal-grounding"],
  };
  const request = { skills: ["exaix-conventions"], userPrompt: "do the thing", taskType: "feature" };

  const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");
  const resolved: string[] = result.skillIds;

  assertEquals(resolved.includes("exaix-conventions"), true, "the pinned skill is present");
  for (const id of blueprint.defaultSkills!) {
    assertEquals(resolved.includes(id), true, `default ${id} must be concatenated, critical or not`);
  }
});

Deno.test("[step17] the resulting set has no duplicates when a pin repeats a default", async () => {
  const runner = createMinimalRunner();
  const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["response-contract", "error-handling"] };
  const request = { skills: ["error-handling"], userPrompt: "do the thing", taskType: "feature" };

  const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");
  const resolved: string[] = result.skillIds;

  assertEquals(resolved.filter((id) => id === "error-handling").length, 1);
});

Deno.test("[step17] a successful dynamic match concatenates ALL defaults, not just critical ones", async () => {
  // Reverses the earlier "critical-only union" rule deliberately. That rule existed to avoid
  // prompt bloat, but it made the resulting set unpredictable — whether a default survived
  // depended on a `critical` flag only 2 of 27 skills set. Bloat is now controlled at the
  // source instead: identity default_skills lists are kept short (Step 17 task D), and
  // `critical` reverts to its other, load-bearing job — surviving context compaction.
  const provider = makeMockProvider();
  const skillsSvc = makeMockSkillsServiceWithDynamicMatch("tdd-methodology", new Set(["response-contract"]));
  const runner = new AgentRunner(provider as any, { skillsService: skillsSvc, disableSkills: false } as any);

  const blueprint: IBlueprint = {
    systemPrompt: "test",
    defaultSkills: ["response-contract", "error-handling", "portal-grounding"],
  };
  const request = { userPrompt: "Fix the null-safety bug in src/utils.ts", taskType: "bugfix" };

  const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");
  const resolved: string[] = result.skillIds;

  assertEquals(resolved.includes("tdd-methodology"), true, "the dynamic match is present");
  for (const id of blueprint.defaultSkills!) {
    assertEquals(resolved.includes(id), true, `default ${id} must be concatenated regardless of critical`);
  }
});
