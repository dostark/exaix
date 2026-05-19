/**
 * @module Request
 * @path packages/core/src/types/request.ts
 * @description Module for Request.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/i_request_service.ts"]
 */

import { z } from "zod";
import type { RequestPriority, RequestSource } from "@exaix/core";
import type { RequestStatusType } from "@exaix/core/status";

import type { IRequestAnalysis } from "@exaix/schemas";

/**
 * AnalysisMode enum for triggering request analysis.
 * Exported here to maintain shared type hierarchy.
 */
export enum AnalysisMode {
  HEURISTIC = "heuristic",
  LLM = "llm",
  HYBRID = "hybrid",
}

export type { IRequestAnalysis };

/**
 * Detailed skills information for a request.
 */
export interface IRequestSkills {
  explicit?: string[]; // User-specified skills
  autoMatched?: string[]; // Skills matched by triggers
  fromDefaults?: string[]; // Skills from agent defaults
  skipped?: string[]; // Skills excluded by user
}

/**
 * Options for creating a request
 */
export interface IRequestOptions {
  /** @deprecated Use identity instead */
  agent?: string;
  /** Identity blueprint to use (Phase 53 canonical field) */
  identity?: string;
  priority?: RequestPriority;
  portal?: string;
  target_branch?: string;
  model?: string;
  flow?: string;
  skills?: string[];
  skipSkills?: string[];
  subject?: string;
  analyze?: boolean;
  analysis_engine?: AnalysisMode;
  /** Explicit acceptance criteria passed via CLI --acceptance-criteria flag (Phase 49). */
  acceptanceCriteria?: string[];
  /** Expected outcomes passed via CLI --expected-outcome flag (Phase 49). */
  expectedOutcomes?: string[];
}

/**
 * Source of request creation
 */

/**
 * Metadata returned when a request is created or listed
 */
export interface IRequestMetadata {
  trace_id: string;
  filename: string;
  path?: string;
  status: RequestStatusType;
  priority: RequestPriority;
  identity: string;
  portal?: string;
  target_branch?: string;
  model?: string;
  flow?: string;
  skills?: string[] | IRequestSkills;
  input_tokens?: string;
  output_tokens?: string;
  total_tokens?: string;
  token_provider?: string;
  token_model?: string;
  token_cost_usd?: string;
  created: string;
  created_by: string;
  source: RequestSource;
  rejected_path?: string;
  subject?: string;
  analysis?: IRequestAnalysis;
}

/**
 * Request entry when listing (includes potential error)
 */
export interface IRequestEntry extends IRequestMetadata {
  error?: string;
}

/**
 * Standard alias for compatibility.
 */
export type IRequest = IRequestEntry;

/**
 * Result of showing a request's full details
 */
export interface IRequestShowResult {
  metadata: IRequestEntry;
  content: string;
  analysis?: IRequestAnalysis;
}

export const MemoryItemSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string(),
  relevance: z.number().min(0).max(1),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const EnhancedRequestSchema = z.object({
  originalRequest: z.string(),
  memories: z.array(MemoryItemSchema),
  memoryContext: z.string(),
  metadata: z.object({
    memoriesRetrieved: z.number(),
    searchTime: z.number(),
    queryTerms: z.array(z.string()).optional(),
  }),
});

export type EnhancedRequest = z.infer<typeof EnhancedRequestSchema>;
