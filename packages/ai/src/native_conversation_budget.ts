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
import type { Opt, Reason } from "@exaix/core/types";
import { type IPromptBudgetSections, PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import type { IModelOptions } from "./types.ts";

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

/** Counts the messages a replayed round or a snapshot adds after the leading prompt.
 *  Each round adds one assistant message and one tool message per call. Each turn adds two. */
export function replayedOpenAiMessageCount(options: Opt<IModelOptions, Reason.OptionalInput>): number {
  if (options?.priorRound) return 1 + options.priorRound.calls.length;
  const snapshot = options?.nativeConversation;
  if (!snapshot) return 0;
  const roundMessages = (snapshot.rounds ?? []).reduce((sum, round) => sum + 1 + round.calls.length, 0);
  return roundMessages + snapshot.turns.length * 2;
}

/** Measures one OpenAI-family projection as dispatched. It counts the leading prompt or the
 *  initial sections, the replayed history after the prompt, and the tools. */
export async function measureOpenAiChatProjection(
  tokenizer: ITokenizer,
  model: string,
  messages: JSONValue[],
  tools: JSONValue,
  prompt: string,
  options: Opt<IModelOptions, Reason.OptionalInput>,
): Promise<INativeInputMeasurement> {
  const history = options?.nativeConversation || options?.priorRound
    ? messages.slice(1, 1 + replayedOpenAiMessageCount(options))
    : [];
  return await measureReplayedProjection(tokenizer, model, { messages, tools }, history, prompt, options);
}

/** Measures one OpenAI Responses projection as dispatched. The leading user prompt is the first input item, so the
 *  replayed history is every item after it. */
export async function measureOpenAiResponsesProjection(
  tokenizer: ITokenizer,
  model: string,
  input: JSONValue[],
  tools: JSONValue,
  prompt: string,
  options: Opt<IModelOptions, Reason.OptionalInput>,
): Promise<INativeInputMeasurement> {
  const history = options?.nativeConversation || options?.priorRound ? input.slice(1) : [];
  return await measureReplayedProjection(tokenizer, model, { messages: input, tools }, history, prompt, options);
}

async function measureReplayedProjection(
  tokenizer: ITokenizer,
  model: string,
  projection: JSONValue,
  history: JSONValue[],
  prompt: string,
  options: Opt<IModelOptions, Reason.OptionalInput>,
): Promise<INativeInputMeasurement> {
  const snapshot = options?.nativeConversation;
  return await measureNativeConversation(tokenizer, model, projection, [
    ...(snapshot?.initialPromptSections ?? [{ section: PromptBudgetSection.SYSTEM, text: prompt }]),
    ...(history.length ? [{ section: PromptBudgetSection.LOOP_HISTORY, text: JSON.stringify(history) }] : []),
  ]);
}
