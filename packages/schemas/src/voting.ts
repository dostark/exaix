/**
 * @module VotingSchemas
 * @path packages/schemas/src/voting.ts
 * @description Voting/consensus Zod schemas for multi-agent voting_group steps (Phase 113).
 * @architectural-layer Schemas
 * @dependencies [zod]
 * @related-files [packages/schemas/src/flow.ts, packages/core/src/types/enums.ts]
 */

import { z } from "zod";
import { VotingModelSlot, VotingStrategy } from "@exaix/core";

export const VotingStrategySchema = z.nativeEnum(VotingStrategy);

export const VotingCandidateSchema = z.object({
  runner_id: z.string().min(1),
  response: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  model: z.string().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
});
export type VotingCandidate = z.infer<typeof VotingCandidateSchema>;

export const VotingResultSchema = z.object({
  trace_id: z.string().uuid(),
  strategy: VotingStrategySchema,
  winner: VotingCandidateSchema,
  candidates: z.array(VotingCandidateSchema).min(1),
  consensus_reached: z.boolean(),
  dissent_summary: z.string().optional(),
});
export type VotingResult = z.infer<typeof VotingResultSchema>;

export const VotingGroupConfigSchema = z.object({
  runners: z.array(z.object({
    blueprint: z.string().min(1),
    model_slot: z.nativeEnum(VotingModelSlot).default(VotingModelSlot.DEFAULT),
    prompt_variant: z.string().optional(),
  })).min(2),
  strategy: VotingStrategySchema.default(VotingStrategy.MAJORITY),
  judge_blueprint: z.string().optional(),
  halt_on_no_consensus: z.boolean().default(true),
  timeout_ms: z.number().int().positive().default(30_000),
}).superRefine((data, ctx) => {
  if (data.strategy === VotingStrategy.LLM_JUDGE && !data.judge_blueprint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["judge_blueprint"],
      message: "judge_blueprint is required when strategy is 'llm-judge'",
    });
  }
});
export type VotingGroupConfig = z.infer<typeof VotingGroupConfigSchema>;
