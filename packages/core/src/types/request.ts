/**
 * @module RequestTypes
 * @path src/types/request.ts
 * @description Request analysis type definitions for @exaix/core consumers.
 */

import type { RequestStatusType } from "../status/request_status.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { RequestPriority, RequestSource } from "@exaix/core";

export enum AnalysisMode {
  HEURISTIC = "heuristic",
  LLM = "llm",
  HYBRID = "hybrid",
}

export type { IRequestAnalysis };

export interface IRequestSkills {
  explicit?: string[];
  autoMatched?: string[];
  fromDefaults?: string[];
  skipped?: string[];
}

export interface IRequestOptions {
  agent?: string;
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
  acceptanceCriteria?: string[];
  expectedOutcomes?: string[];
}

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

export interface IRequestEntry extends IRequestMetadata {
  error?: string;
}

export type IRequest = IRequestEntry;

export interface IRequestShowResult {
  metadata: IRequestEntry;
  content: string;
  analysis?: IRequestAnalysis;
}
