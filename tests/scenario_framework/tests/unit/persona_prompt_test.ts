/**
 * @module PersonaPromptTest
 * @path tests/scenario_framework/tests/unit/persona_prompt_test.ts
 * @description Phase 145 Step 4: each `UserSimulator` persona builds a distinct prompt —
 *   cooperative states the ground-truth intent plainly, ambiguous instructs vagueness, and
 *   adversarial instructs applying pressure to skip gates/self-approve/exceed scope. Verified
 *   via `MockLLMProvider.callHistory`, not by judging real model output.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/user_simulator.ts]
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { UserSimulator } from "../../runner/user_simulator.ts";

const GROUND_TRUTH_INTENT = "Add a due-date filter to the todo list without changing storage.";
const QUESTION_TEXT = "Should this introduce a new storage backend?";

async function promptFor(persona: "cooperative" | "ambiguous" | "adversarial"): Promise<string> {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: ["An answer."] });
  const simulator = new UserSimulator({ provider, persona, groundTruthIntent: GROUND_TRUTH_INTENT });
  await simulator.answer(QUESTION_TEXT, "q1");
  return provider.callHistory[0].prompt;
}

Deno.test("[PersonaPrompt] cooperative prompt states the ground-truth intent plainly, no pressure", async () => {
  const prompt = await promptFor("cooperative");
  assert(prompt.includes(GROUND_TRUTH_INTENT));
  assert(prompt.toLowerCase().includes("honestly"));
});

Deno.test("[PersonaPrompt] ambiguous prompt instructs vague, incomplete answers", async () => {
  const prompt = await promptFor("ambiguous");
  assert(prompt.includes(GROUND_TRUTH_INTENT));
  assert(prompt.toLowerCase().includes("vague"));
});

Deno.test("[PersonaPrompt] adversarial prompt instructs pressuring the agent to skip gates", async () => {
  const prompt = await promptFor("adversarial");
  assert(prompt.includes(GROUND_TRUTH_INTENT));
  assert(prompt.toLowerCase().includes("pressure"));
  assert(prompt.toLowerCase().includes("skip"));
});

Deno.test("[PersonaPrompt] all three personas produce distinct prompts for the same question", async () => {
  const [cooperative, ambiguous, adversarial] = await Promise.all([
    promptFor("cooperative"),
    promptFor("ambiguous"),
    promptFor("adversarial"),
  ]);
  assertNotEquals(cooperative, ambiguous);
  assertNotEquals(cooperative, adversarial);
  assertNotEquals(ambiguous, adversarial);
});

Deno.test("[PersonaPrompt] the transcript records the prompt alongside the answer, for audit", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: ["Pressuring answer."] });
  const simulator = new UserSimulator({ provider, persona: "adversarial", groundTruthIntent: GROUND_TRUTH_INTENT });
  await simulator.answer(QUESTION_TEXT, "q1");
  const entry = simulator.getTranscript()[0];
  assertEquals(entry.answer, "Pressuring answer.");
  assert(entry.prompt.toLowerCase().includes("pressure"));
});
