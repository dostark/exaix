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
  /** Identity blueprint to use for this request. CANONICAL since Phase 173 GAP-1:
   *  this used to be `identity` while writer-side RequestSchema mandated `identity_id`,
   *  so generated requests failed admission (`RequestProcessor.getRequestKindOrFail`
   *  found neither field). */
  identity_id?: string;
  flow?: string;
  source: string;
  created_by: string;
  portal?: string;
  /** Enable runtime routing policy selection for this request */
  allow_dynamic_routing?: boolean;
  target_branch?: string;
  model?: string;
  /** Model size intent: S|M|L|XL (Phase 132) */
  model_size?: string;
  /** Provider preference hint (Phase 132) */
  preferred_provider?: string;
  /** Enable extended thinking (Phase 132) */
  thinking?: boolean;
  /** Reasoning effort tier: low|medium|high (Phase 132) */
  effort?: string;
  /** Soft hints: cheapest|fastest, repeatable (Phase 132) */
  characteristics?: string[];
  /**
   * Skills to apply for this request. Accepts a YAML array (`skills: [a, b]`, how requests
   * are hand-authored) or a string — the CLI writes a JSON-encoded array via JSON.stringify,
   * and a bare comma-separated list is also tolerated. buildParsedRequest normalises all
   * three. Typing this `string` alone made a hand-written array throw on `.trim()`.
   */
  skills?: string[] | string;
  /** Tags used by skill trigger matching and identity routing. Declared in RequestSchema but
   * previously absent here, so no builder could copy them and tag-driven matching never
   * fired. Accepts a list or a lone string, matching what raw YAML can yield. */
  tags?: string[] | string;
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
  /** Scenario id stamped by the scenario runner via EXA_SCENARIO_ID, for fixture replay
   *  call-site addressing (Phase 157). Absent outside the scenario framework. */
  scenario_id?: string;
  /** Step id stamped by the scenario runner via EXA_STEP_ID, for fixture replay call-site
   *  addressing (Phase 157). Absent outside the scenario framework. */
  step_id?: string;
}

export interface IParsedRequestFile {
  frontmatter: IRequestFrontmatter;
  body: string;
  rawContent: string;
}
