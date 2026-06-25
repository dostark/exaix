/**
 * @module RequestFrontmatter
 * @path packages/core/src/request/request_frontmatter.ts
 * @description Shared request frontmatter and parsed request-file contracts.
 * @architectural-layer Shared
 * @related-files ["packages/request/src/processing/parser.ts", "packages/core/src/request/mod.ts"]
 */

import type { RequestStatusType } from "@exaix/core/status";

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
  /** Enable runtime routing policy selection for this request */
  allow_dynamic_routing?: boolean;
  target_branch?: string;
  model?: string;
  skills?: string;
  subject?: string;
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
