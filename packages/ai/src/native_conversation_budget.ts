/**
 * @module NativeConversationBudget
 * @path packages/ai/src/native_conversation_budget.ts
 * @description Measures the complete provider projection and preserves caller-owned prompt sections.
 * @architectural-layer AI
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/ai/src/types.ts, packages/ai-openai/src/openai_provider.ts]
 */
import type { JSONValue } from "@exaix/core";
import type { ITokenizer } from "@exaix/core/func";
import type { IPromptBudgetSections } from "@exaix/schemas/prompt_budget.ts";

export interface INativePromptSection {
  section: `${keyof IPromptBudgetSections}`;
  text: string;
}

export interface INativeInputMeasurement {
  totalTokens: number;
  sections: IPromptBudgetSections;
  tokenSource: "tokenizer_estimate";
}

/** Charges framing and tool/schema/control overhead to system without parsing prompt prose. */
export async function measureNativeConversation(
  tokenizer: ITokenizer,
  model: string,
  projection: JSONValue,
  segments: readonly INativePromptSection[],
): Promise<INativeInputMeasurement> {
  const sections: IPromptBudgetSections = {
    system: 0,
    plan: 0,
    portalKnowledge: 0,
    memory: 0,
    skills: 0,
    loopHistory: 0,
  };
  const counts = await tokenizer.countTokensBatch(segments.map((segment) => segment.text), model);
  for (const [index, segment] of segments.entries()) sections[segment.section] += counts[index];
  const segmentTokens = Object.values(sections).reduce((sum, count) => sum + count, 0);
  const totalTokens = Math.max(segmentTokens, await tokenizer.countTokens(JSON.stringify(projection), model));
  sections.system += totalTokens - segmentTokens;
  return { totalTokens, sections, tokenSource: "tokenizer_estimate" };
}
