/**
 * @module SkillRunnerFixture
 * @path packages/execution/tests/helpers/skill_runner_fixture.ts
 * @description An AgentRunner wired to a stub provider and a stub skills service, for tests that assert on the skills.resolved journal event.
 * @architectural-layer Unit
 * @dependencies [@exaix/execution, @exaix/core, @exaix/testing]
 * @related-files [packages/execution/tests/agent_runner_skill_resolution_event_test.ts, packages/execution/tests/skill_suppression_test.ts]
 */

import { AgentRunner } from "@exaix/execution";
import { SKILL_EVENT_RESOLVED } from "@exaix/core";
import { castAny, createCapturingLogger, type ICapturedEvent } from "@exaix/testing";

function makeMockProvider() {
  return {
    generate: () =>
      Promise.resolve({
        content: "{}",
        toolCalls: [],
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
    forContext() {
      return this;
    },
    recordSubmission: () => Promise.resolve(),
    currentConfigGeneration: () => "test-generation",
    ensureRevisions: () => Promise.resolve(),
    matchSkills: () =>
      Promise.resolve({ matches: matches.map((m) => ({ ...m, matchedTriggers: {} })), totalAvailable: matches.length }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (id: string) =>
      Promise.resolve(castAny({ id, name: id, description: "", instructions: "", triggers: {}, critical: false })),
    initialize: () => Promise.resolve(),
  };
}

/** Builds a runner whose skills service returns `matches` and whose journal events land in `captured`. */
export function createRunner(
  captured: ICapturedEvent[],
  matches: { skillId: string; confidence: number }[] = [],
): AgentRunner {
  return new AgentRunner(
    castAny(makeMockProvider()),
    castAny({
      skillsService: makeSkillsService(matches),
      disableSkills: false,
      logger: createCapturingLogger(captured),
    }),
  );
}

/** Keeps the `skills.resolved` events. */
export function resolutionEvents(captured: ICapturedEvent[]): ICapturedEvent[] {
  return captured.filter((event) => event.action === SKILL_EVENT_RESOLVED);
}
