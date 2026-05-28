/**
 * @module ExecutionTypes
 * @path packages/execution/src/types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Shared types for the @exaix/execution package.
 */

import { z } from "zod";
import { CritiqueIssueType, CritiqueQuality, CritiqueSeverity } from "@exaix/core";
import { RequirementFulfillmentSchema } from "@exaix/core/types";

export const CritiqueSchema = z.object({
  quality: z.nativeEnum(CritiqueQuality),
  confidence: z.number().min(0).max(100),
  passed: z.boolean(),
  issues: z.array(z.object({
    type: z.nativeEnum(CritiqueIssueType),
    severity: z.nativeEnum(CritiqueSeverity),
    description: z.string(),
    suggestion: z.string().optional(),
  })).default([]),
  reasoning: z.string(),
  improvements: z.array(z.string()).optional(),
  requirementsFulfillment: z.array(RequirementFulfillmentSchema).optional(),
});

export type ICritique = z.infer<typeof CritiqueSchema>;

/**
 * Entry for a completed execution step in loop history.
 * Each step records its outcome for potential summarization.
 */
export interface ILoopHistoryEntry {
  type: "step";
  stepId: string;
  description: string;
  filesChanged: string[];
  tokens: number;
  timestamp: number;
}

/**
 * Compacted summary of multiple completed steps.
 * Replaces individual step entries when budget pressure triggers summarization.
 */
export interface ICompactedEntry {
  type: "compacted";
  summary: string;
  compressedFrom: string[];
  originalStepIds: string[];
  tokens: number;
  timestamp: number;
}
