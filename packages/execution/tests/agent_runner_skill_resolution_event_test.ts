// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentRunnerSkillResolutionEventTest
 * @path packages/execution/tests/agent_runner_skill_resolution_event_test.ts
 * @description Phase 142 Step 17E — verifies AgentRunner journals `skills.resolved` for
 *   EVERY request, with the pinned/matched/defaults breakdown that produced the final set.
 *
 *   `skills.match_completed` is emitted by SkillsService.matchSkills, which the runner
 *   deliberately skips when the request pins skills explicitly. That left the pinned path —
 *   the one the skill_eval pack exercises — with no journal record at all: the resulting
 *   skill set was unobservable, and the pack's wait-for-event steps passed or failed on
 *   whether some unrelated plan step happened to call matchSkills. Under the
 *   always-concatenate model the union is the interesting fact, so the union is what gets
 *   journaled, and the breakdown answers "why is this skill in my prompt?".
 * @architectural-layer Unit
 * @dependencies [@exaix/execution, @exaix/core]
 * @related-files [packages/execution/src/agent_runner.ts, tests/scenario_framework/scenarios/skill_eval/]
 */

import { assertEquals } from "@std/assert";
import type { IBlueprint } from "@exaix/execution";
import type { ICapturedEvent } from "@exaix/testing";
import { createRunner, resolutionEvents } from "./helpers/skill_runner_fixture.ts";

/** The `skills.resolved` payload fields these tests assert on. */
interface IResolutionPayload {
  skill_ids?: string[];
  skill_count?: number;
  pinned_skill_ids?: string[];
  matched_skill_ids?: string[];
  default_skill_ids?: string[];
}

Deno.test("[step17e] a pinned request journals skills.resolved even though matching is skipped", async () => {
  const captured: ICapturedEvent[] = [];
  const runner = createRunner(captured);
  const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["response-contract", "error-handling"] };
  const request = { skills: ["portal-grounding"], userPrompt: "do the thing", taskType: "feature" };

  await (runner as any).matchAndApplySkills(blueprint, request, "test-role");

  const events = resolutionEvents(captured);
  assertEquals(events.length, 1, "exactly one resolution event per skill-management pass");

  const payload = events[0].payload as IResolutionPayload;
  assertEquals(payload.pinned_skill_ids, ["portal-grounding"]);
  assertEquals(payload.matched_skill_ids, []);
  assertEquals(payload.default_skill_ids, ["response-contract", "error-handling"]);
  assertEquals(payload.skill_ids, ["portal-grounding", "response-contract", "error-handling"]);
  assertEquals(payload.skill_count, 3);
});

Deno.test("[step17e] a dynamically matched request journals the matched ids separately from defaults", async () => {
  const captured: ICapturedEvent[] = [];
  const runner = createRunner(captured, [{ skillId: "tdd-methodology", confidence: 0.9 }]);
  const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["response-contract"] };
  const request = { userPrompt: "Fix the null-safety bug in src/utils.ts", taskType: "bugfix" };

  await (runner as any).matchAndApplySkills(blueprint, request, "test-role");

  const payload = resolutionEvents(captured)[0].payload as IResolutionPayload;
  assertEquals(payload.pinned_skill_ids, []);
  assertEquals(payload.matched_skill_ids, ["tdd-methodology"]);
  assertEquals(payload.default_skill_ids, ["response-contract"]);
  assertEquals(payload.skill_ids, ["tdd-methodology", "response-contract"]);
});

Deno.test("[step17e] a request that resolves to no skills at all is still journaled", async () => {
  // A zero-skill outcome is a real result, not an absence of one: without the event you
  // cannot tell "no skill applied" apart from "skill resolution never ran".
  const captured: ICapturedEvent[] = [];
  const runner = createRunner(captured);
  const blueprint: IBlueprint = { systemPrompt: "test" };
  const request = { userPrompt: "hello", taskType: "chat" };

  await (runner as any).matchAndApplySkills(blueprint, request, "test-role");

  const payload = resolutionEvents(captured)[0].payload as IResolutionPayload;
  assertEquals(payload.skill_ids, []);
  assertEquals(payload.skill_count, 0);
});
