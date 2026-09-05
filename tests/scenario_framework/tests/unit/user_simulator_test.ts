/**
 * @module UserSimulatorTest
 * @path tests/scenario_framework/tests/unit/user_simulator_test.ts
 * @description Deterministic (seeded-provider) test of `UserSimulator`: cooperative-persona
 *   answers are well-formed and journaled to its own transcript. Per-persona prompt content
 *   (ambiguous/adversarial) is covered separately by `persona_prompt_test.ts` (Phase 145 Step 4).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/user_simulator.ts, tests/scenario_framework/tests/unit/persona_prompt_test.ts]
 */

import { assertEquals } from "@std/assert";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { type IUserSimulatorPersona, UserSimulator } from "../../runner/user_simulator.ts";

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
  const transcript = simulator.getTranscript();
  assertEquals(transcript.length, 1);
  assertEquals(transcript[0].questionId, "q1");
  assertEquals(transcript[0].questionText, "Should this introduce a new storage backend?");
  assertEquals(transcript[0].answer, "Use the existing TaskRepository — no new storage layer needed.");
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
  snapshot.push({ questionId: "fake", questionText: "fake", prompt: "fake", answer: "fake" });
  assertEquals(simulator.getTranscript().length, 1);
});

Deno.test("[UserSimulator] all three personas construct and answer without throwing", async () => {
  const personas: IUserSimulatorPersona[] = ["cooperative", "ambiguous", "adversarial"];
  for (const persona of personas) {
    const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: ["An answer."] });
    const simulator = new UserSimulator({ provider, persona, groundTruthIntent: "Intent." });
    const answer = await simulator.answer("Q?", "q1");
    assertEquals(answer, "An answer.");
  }
});
