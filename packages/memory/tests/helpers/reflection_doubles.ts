/**
 * @module ReflectionTestDoubles
 * @path packages/memory/tests/helpers/reflection_doubles.ts
 * @description A model provider that answers with fixed content and records its calls, and a skills stub that serves the content policy, for the memory reflection tests.
 * @architectural-layer Test
 * @related-files [packages/memory/tests/reflection/reflection_consolidation_test.ts]
 */

import type { IModelProvider } from "@exaix/ai";
import type { IReflectionSkills } from "@exaix/memory/reflection/memory_reflection_service.ts";
import { castAny } from "@exaix/testing";

const CONTENT_POLICY_SKILL_ID = "memory-extraction-content-policy";

/** A provider that always answers with the given content, and keeps the last prompt and the call count. */
export class FixedContentProvider implements IModelProvider {
  prompt = "";
  calls = 0;

  constructor(private readonly content: string, readonly id: string = "reflection-test") {}

  generate(prompt: string = ""): ReturnType<IModelProvider["generate"]> {
    this.calls++;
    this.prompt = prompt;
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0.002,
    });
  }
}

/** A skills stub that serves the given instructions as the content-policy skill and no other skill. */
export function reflectionSkills(instructions: string): IReflectionSkills {
  return castAny<IReflectionSkills>({
    recordSubmission: () => Promise.resolve(),
    currentConfigGeneration: () => "static",
    getSkill: (skillId: string) =>
      Promise.resolve(skillId === CONTENT_POLICY_SKILL_ID ? { skill_id: skillId, instructions } : null),
  });
}
