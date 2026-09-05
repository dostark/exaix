/**
 * @module UserSimulatorTest
 * @path tests/scenario_framework/tests/unit/user_simulator_test.ts
 * @description Deterministic (seeded-provider) test of `UserSimulator`: cooperative-persona
 *   answers are well-formed and journaled to its own transcript. Phase 145 Step 2.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/user_simulator.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { UserSimulator } from "../../runner/user_simulator.ts";

Deno.test("[UserSimulator] cooperative persona returns the provider's answer and journals it", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Use the existing TaskRepository — no new storage layer needed."],
  });
  const simulator = new UserSimulator({
    provider,
    persona: "cooperative",
    groundTruthIntent: "Add a due-date filter to the todo list without changing storage.",
  });

  const answer = await simulator.answer("Should this introduce a new storage backend?", "q1");
  assertEquals(answer, "Use the existing TaskRepository — no new storage layer needed.");
  assertEquals(simulator.getTranscript(), [
    {
      questionId: "q1",
      questionText: "Should this introduce a new storage backend?",
      answer: "Use the existing TaskRepository — no new storage layer needed.",
    },
  ]);
});

Deno.test("[UserSimulator] journals every answer across multiple rounds in order", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Answer one.", "Answer two."],
  });
  const simulator = new UserSimulator({
    provider,
    persona: "cooperative",
    groundTruthIntent: "Ground truth intent.",
  });

  await simulator.answer("Question one?", "q1");
  await simulator.answer("Question two?", "q2");

  assertEquals(simulator.getTranscript().map((entry) => entry.answer), ["Answer one.", "Answer two."]);
});

Deno.test("[UserSimulator] getTranscript returns a copy, not a live reference", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: ["An answer."] });
  const simulator = new UserSimulator({ provider, persona: "cooperative", groundTruthIntent: "Intent." });
  await simulator.answer("Q?", "q1");
  const snapshot = simulator.getTranscript();
  snapshot.push({ questionId: "fake", questionText: "fake", answer: "fake" });
  assertEquals(simulator.getTranscript().length, 1);
});

Deno.test("[UserSimulator] non-cooperative personas are not yet implemented (Step 4)", () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: ["x"] });
  assertThrows(
    () => new UserSimulator({ provider, persona: "adversarial", groundTruthIntent: "Intent." }),
    Error,
    "not yet implemented",
  );
});
