/**
 * @module VotingSchemaTest
 * @path packages/schemas/tests/voting_test.ts
 * @description Unit tests for voting/consensus schemas (Phase 113 Step 1).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowStepType } from "@exaix/core";
import { FlowStepSchema } from "@exaix/schemas";
import { ZodError } from "zod";
import { VotingGroupConfigSchema, VotingResultSchema, VotingStrategySchema } from "@exaix/schemas/voting.ts";

Deno.test("voting-rejects-fewer-than-two-runners", () => {
  assertThrows(
    () =>
      VotingGroupConfigSchema.parse({
        runners: [{ blueprint: "agent-a" }],
      }),
    ZodError,
  );
});

Deno.test("voting-strategy-accepts-three-values", () => {
  const result1 = VotingStrategySchema.parse("majority");
  assertEquals(result1, "majority");

  const result2 = VotingStrategySchema.parse("weighted");
  assertEquals(result2, "weighted");

  const result3 = VotingStrategySchema.parse("llm-judge");
  assertEquals(result3, "llm-judge");
});

Deno.test("llm-judge-requires-judge-blueprint", () => {
  assertThrows(
    () =>
      VotingGroupConfigSchema.parse({
        runners: [
          { blueprint: "agent-a" },
          { blueprint: "agent-b" },
        ],
        strategy: "llm-judge",
      }),
    ZodError,
  );
});

Deno.test("llm-judge-accepts-voting-judge-blueprint", () => {
  const result = VotingGroupConfigSchema.parse({
    runners: [
      { blueprint: "agent-a" },
      { blueprint: "agent-b" },
    ],
    strategy: "llm-judge",
    judge_blueprint: "voting-judge",
  });
  assertEquals(result.judge_blueprint, "voting-judge");
  assertEquals(result.strategy, "llm-judge");
});

Deno.test("result-rejects-missing-winner-or-empty-candidates", () => {
  assertThrows(
    () =>
      VotingResultSchema.parse({
        trace_id: crypto.randomUUID(),
        strategy: "majority",
        candidates: [],
      }),
    ZodError,
  );
});

Deno.test("flow-step-accepts-voting-group-type", () => {
  const step = FlowStepSchema.parse({
    id: "vote",
    name: "Vote on Result",
    identity: "senior-coder",
    type: "voting_group",
    voting: {
      runners: [
        { blueprint: "agent-a" },
        { blueprint: "agent-b" },
        { blueprint: "agent-c" },
      ],
      strategy: "majority",
    },
  });
  assertEquals(step.type, FlowStepType.VOTING_GROUP);
});

Deno.test("existing-flow-without-voting-parses", () => {
  const step = FlowStepSchema.parse({
    id: "analyze",
    name: "Analyze",
    identity: "senior-coder",
  });
  assertEquals(step.type, FlowStepType.AGENT);
});
