/**
 * @module RequestProcessingTypes
 * @path src/services/request_processing/types.ts
 * @description Type definitions for request processing, including frontmatter and parsed file structures.
 * @architectural-layer Services
 * @dependencies [RequestStatus]
 * @related-files [src/services/request_processor.ts, src/requests/request_status.ts]
 */
import type { RequestStatusType } from "../../shared/status/request_status.ts";

export interface IRequestFrontmatter {
  trace_id: string;
  created: string;
  status: RequestStatusType;
  priority: string;
  /** Identity blueprint to use for this request (Phase 54 canonical field) */
  identity?: string;
  flow?: string;
  source: string;
  created_by: string;
  portal?: string;
  target_branch?: string;
  model?: string;
  skills?: string;
  subject?: string;
  subject_is_fallback?: boolean;
  /** ISO timestamp set by the quality gate after first assessment. Prevents re-assessment on re-entry. */
  assessed_at?: string;
  /** Path to the sibling `_clarification.json` file when a Q&A session exists. */
  clarification_session_path?: string;
  /** Explicit acceptance criteria parsed from YAML frontmatter (Phase 49). */
  acceptance_criteria?: string[];
  /** Expected outcomes parsed from YAML frontmatter (Phase 49). */
  expected_outcomes?: string[];
  /** Scope constraints parsed from YAML frontmatter (Phase 49). */
  scope?: { include?: string[]; exclude?: string[] };
}

export interface ParsedRequestFile {
  frontmatter: IRequestFrontmatter;
  body: string;
  rawContent: string;
}
