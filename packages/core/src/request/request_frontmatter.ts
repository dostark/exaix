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
  /** Agent role blueprint to use for this request. Must match writer-side RequestSchema's
   *  `agent_role` field name exactly — a mismatched field name here made generated
   *  requests fail admission (neither field found by RequestProcessor). */
  agent_role?: string;
  flow?: string;
  source: string;
  created_by: string;
  portal?: string;
  /** Enable runtime routing policy selection for this request */
  allow_dynamic_routing?: boolean;
  target_branch?: string;
  model?: string;
  /** Model size intent: S|M|L|XL */
  model_size?: string;
  /** Provider preference hint */
  preferred_provider?: string;
  /** Enable extended thinking */
  thinking?: boolean;
  /** Reasoning effort tier: low|medium|high */
  effort?: string;
  /** Soft hints: cheapest|fastest, repeatable */
  characteristics?: string[];
  /** Skills to apply for this request. Accepts a YAML array (hand-authored), a JSON-encoded
   * array string (CLI-written), or a bare comma-separated string — `buildParsedRequest`
   * normalises all three; typing this `string` alone broke hand-written arrays' `.trim()`. */
  skills?: string[] | string;
  /** Tags used by skill trigger matching and agent-role routing. Declared in RequestSchema but
   * previously absent here, so no builder could copy them and tag-driven matching never
   * fired. Accepts a list or a lone string, matching what raw YAML can yield. */
  tags?: string[] | string;
  subject?: string;
  /** ISO timestamp set by the quality gate after first assessment. Prevents re-assessment on re-entry. */
  assessed_at?: string;
  /** Path to the sibling `_clarification.json` file when a Q&A session exists. */
  clarification_session_path?: string;
  /** Explicit acceptance criteria parsed from YAML frontmatter. */
  acceptance_criteria?: string[];
  /** Expected outcomes parsed from YAML frontmatter. */
  expected_outcomes?: string[];
  /** Scope constraints parsed from YAML frontmatter. */
  scope?: { include?: string[]; exclude?: string[] };
  /** Scenario id stamped by the scenario runner via EXA_SCENARIO_ID, for fixture replay
   *  call-site addressing. Absent outside the scenario framework. */
  scenario_id?: string;
  /** Step id stamped by the scenario runner via EXA_STEP_ID, for fixture replay call-site
   *  addressing. Absent outside the scenario framework. */
  step_id?: string;
  /** Worktree-relative `.exa/PlanContext/<slug>.md` pointer stamped by
   *  `scripts/plan_to_requests.ts --plan-context-root`. Required by
   *  RequestProcessor for a flow request whose flow has a session_delegate_cycle step. */
  plan_context_ref?: string;
}

export interface IParsedRequestFile {
  frontmatter: IRequestFrontmatter;
  body: string;
  rawContent: string;
}
