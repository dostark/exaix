// deno-lint-ignore-file no-explicit-any
/**
 * @module SkillSuppressionTest
 * @path packages/execution/tests/skill_suppression_test.ts
 * @description Phase 158 Step 2 (closes GAP-2) — a run-scoped skill-ablation arm
 * suppresses a skill from AgentRunner's resolved set via the EXA_EVAL_SUPPRESS_SKILLS
 * env var, without adding a request-contract field. Suppression applies to the FINAL
 * resolved set (pinned ∪ matched ∪ defaults), not only the dynamic-match sub-path, so a
 * pinned or default-sourced skill is suppressed just as reliably as a dynamically
 * matched one — otherwise a skill-ablation arm's control side would not actually be an
 * ablation for skills that only ever arrive via a pin or a default.
 * @architectural-layer Unit
 * @dependencies [@exaix/execution]
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { AgentRunner, EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR } from "@exaix/execution";
import type { IBlueprint } from "@exaix/execution";
import { SKILL_EVENT_RESOLVED } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

function makeMockProvider() {
  return {
    generate: () =>
      Promise.resolve({
        content: "{}",
        toolCalls: [] as any[],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock",
        provider: "mock",
      }),
    stream: () => Promise.reject(new Error("not implemented")),
    getModelInfo: () => ({ provider: "mock", model: "mock" }),
    name: "mock",
  };
}

function makeSkillsService(matches: { skillId: string; confidence: number }[]) {
  return {
    recordSkillUsage: () => Promise.resolve(),
    matchSkills: () =>
      Promise.resolve({ matches: matches.map((m) => ({ ...m, matchedTriggers: {} })), totalAvailable: matches.length }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (id: string) =>
      Promise.resolve({ id, name: id, description: "", instructions: "", triggers: {}, critical: false } as any),
    initialize: () => Promise.resolve(),
  };
}

function createRunner(captured: ICapturedEvent[], matches: { skillId: string; confidence: number }[] = []) {
  return new AgentRunner(makeMockProvider() as any, {
    skillsService: makeSkillsService(matches),
    disableSkills: false,
    logger: createCapturingLogger(captured),
  } as any);
}

function resolutionEvents(captured: ICapturedEvent[]): ICapturedEvent[] {
  return captured.filter((event) => event.action === SKILL_EVENT_RESOLVED);
}

/** Runs `fn` with EXA_EVAL_SUPPRESS_SKILLS set, always restoring the prior value. */
async function withSuppressedSkills<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
  try {
    if (value === undefined) Deno.env.delete(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
    else Deno.env.set(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR, value);
    return await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
    else Deno.env.set(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR, previous);
  }
}

Deno.test("[SkillSuppression] a suppressed default skill is absent from the resolved set", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = {
      systemPrompt: "test",
      defaultSkills: ["tdd-methodology", "error-handling"],
    };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertEquals(resolved.includes("tdd-methodology"), false, "the suppressed skill must not be in the resolved set");
    assertEquals(resolved.includes("error-handling"), true, "an unsuppressed default must still be present");
  });
});

Deno.test("[SkillSuppression] a suppressed pinned skill is absent from the resolved set", async () => {
  await withSuppressedSkills("exaix-conventions", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { skills: ["exaix-conventions"], userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertEquals(resolved.includes("exaix-conventions"), false, "a pin does not override suppression");
  });
});

Deno.test("[SkillSuppression] a suppressed dynamically-matched skill is absent from the resolved set", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured, [{ skillId: "tdd-methodology", confidence: 1.0 }]);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { userPrompt: "fix the bug", taskType: "bugfix" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertEquals(resolved.includes("tdd-methodology"), false);
  });
});

Deno.test("[SkillSuppression] skills.resolved records which skill(s) were suppressed", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology", "error-handling"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    await (runner as any).matchAndApplySkills(blueprint, request, "test-role");

    const events = resolutionEvents(captured);
    assertEquals(events.length, 1);
    const payload = events[0].payload as { suppressed_skill_ids?: string[] };
    assertEquals(payload.suppressed_skill_ids, ["tdd-methodology"]);
  });
});

Deno.test("[SkillSuppression] with no suppression env var set, resolution is unaffected", async () => {
  await withSuppressedSkills(undefined, async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology", "error-handling"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertEquals(resolved.includes("tdd-methodology"), true);
    assertEquals(resolved.includes("error-handling"), true);
  });
});

Deno.test("[SkillSuppression] an empty suppression list suppresses nothing", async () => {
  await withSuppressedSkills("", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    assertEquals(result.skillIds.includes("tdd-methodology"), true);
  });
});
