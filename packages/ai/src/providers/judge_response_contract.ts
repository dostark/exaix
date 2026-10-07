/**
 * @module JudgeResponseContract
 * @path packages/ai/src/providers/judge_response_contract.ts
 * @description Raw judge JSON contract shared by fixture capture and strict keyed replay.
 * @architectural-layer AI
 * @dependencies [zod]
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts, packages/ai/src/providers/mock_llm_provider.ts]
 */
import { z } from "zod";

const JudgeResponseSchema = z.object({
  criteriaScores: z.record(z.string(), z.object({ score: z.number().min(0).max(1) })),
  feedback: z.string(),
  suggestions: z.array(z.string()),
});

/** Returns why a raw judge response violates the contract for the requested criteria, or null. */
export function validateJudgeResponse(response: string, criteria: string[]): string | null {
  try {
    const parsed = JudgeResponseSchema.safeParse(JSON.parse(response));
    if (!parsed.success) return "judge JSON requires bounded criterion scores, feedback and suggestions";
    if (criteria.some((name) => !(name in parsed.data.criteriaScores))) {
      return "judge JSON is missing a requested criterion";
    }
    return null;
  } catch {
    return "judge response must contain raw JSON";
  }
}
