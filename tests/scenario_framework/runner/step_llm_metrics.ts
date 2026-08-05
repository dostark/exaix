/**
 * @module ScenarioFrameworkStepLlmMetrics
 * @path tests/scenario_framework/runner/step_llm_metrics.ts
 * @description Reads real per-step LLM duration, token, and tracked-cost metrics back out of
 * the workspace journal (`.exa/journal.db`), scoped to the exact rowid window synthetic_runner
 * already tracks per step. Phase 140a Step 3.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/runner/synthetic_runner.ts, packages/execution/src/agent_orchestrator.ts]
 */

import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { AGENT_EVENT_EXECUTION_COMPLETED, AGENT_GENERATION_COMPLETED } from "@exaix/core";
import { parseDelegateStdout } from "@exaix/session";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";

export interface IStepLlmMetricsTokens {
  prompt: number;
  completion: number;
  cacheRead?: number;
  cacheCreation?: number;
  total: number;
}

export interface IStepLlmMetrics {
  llmDurationMs?: number;
  tokens?: IStepLlmMetricsTokens;
  trackedCostUsd?: number;
}

interface IActivityMetricsRow {
  execution_time_ms_sum: number | null;
  generation_duration_ms_sum: number | null;
  prompt_tokens_sum: number | null;
  completion_tokens_sum: number | null;
  cache_read_tokens_sum: number | null;
  cache_creation_tokens_sum: number | null;
  tracked_cost_usd_sum: number | null;
  row_count: number;
}

/**
 * Phase 143 Step 1 — map a bare cell's delegate step stdout into the history step fields,
 * reusing the daemon's own `parseDelegateStdout` (pre-gap GAP-3: never reimplement delegate
 * parsing). Claude `{type:"result"}` usage and OpenCode JSONL `step_finish` token/cost events
 * land in `tokens_*` / `tracked_cost_usd` exactly as the journal path records them. Absent cost
 * stays `undefined` (the frontier view renders "—"); a stdout with nothing parseable records NO
 * metrics — fake zeros would read as "free run" in every cost view.
 */
export function parseDelegateStepLlmMetrics(stdout: string, tool: SessionTool): IStepLlmMetrics {
  const parsed = parseDelegateStdout(stdout, tool);
  if (parsed.tokenStats.total === 0 && parsed.costUsd === undefined) {
    return {};
  }
  return {
    tokens: {
      prompt: parsed.tokenStats.input,
      completion: parsed.tokenStats.output,
      cacheRead: parsed.tokenStats.cacheRead,
      cacheCreation: parsed.tokenStats.cacheCreation,
      total: parsed.tokenStats.total,
    },
    trackedCostUsd: parsed.costUsd,
  };
}

/**
 * Sums `agent.execution_completed`/`agent.generation_completed` activity rows in
 * `(sinceRowid, untilRowid]` into per-step LLM metrics. Resolves `dbPath` internally exactly as
 * `step_executor.ts:currentMaxRowid` does, for signature consistency with that sibling function.
 * Returns all-undefined metrics (never throws) when the journal is missing, empty, or the window
 * contains no matching rows — a shell/wait-for-file step has no LLM call in its window, and that
 * is a normal, not an error, outcome.
 */
export async function readStepLlmMetrics(
  workspaceRoot: string,
  sinceRowid: number,
  untilRowid: number,
): Promise<IStepLlmMetrics> {
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  try {
    await Deno.stat(dbPath);
  } catch {
    return {};
  }

  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        `SELECT
          SUM(CASE WHEN action_type = ? THEN json_extract(payload, '$.execution_time_ms') ELSE 0 END) AS execution_time_ms_sum,
          SUM(CASE WHEN action_type = ? THEN json_extract(payload, '$.duration_ms') ELSE 0 END) AS generation_duration_ms_sum,
          SUM(prompt_tokens) AS prompt_tokens_sum,
          SUM(completion_tokens) AS completion_tokens_sum,
          SUM(json_extract(payload, '$.usage.cache_read_tokens')) AS cache_read_tokens_sum,
          SUM(json_extract(payload, '$.usage.cache_creation_tokens')) AS cache_creation_tokens_sum,
          SUM(CASE WHEN json_extract(payload, '$.usage.cost_source') = 'tracked' THEN json_extract(payload, '$.usage.cost_usd_estimate') ELSE NULL END) AS tracked_cost_usd_sum,
          COUNT(*) AS row_count
        FROM activity
        WHERE rowid > ? AND rowid <= ? AND action_type IN (?, ?)`,
      )
      .get<IActivityMetricsRow>(
        AGENT_EVENT_EXECUTION_COMPLETED,
        AGENT_GENERATION_COMPLETED,
        sinceRowid,
        untilRowid,
        AGENT_EVENT_EXECUTION_COMPLETED,
        AGENT_GENERATION_COMPLETED,
      );

    if (!row || row.row_count === 0) return {};

    const llmDurationMs = (row.execution_time_ms_sum ?? 0) + (row.generation_duration_ms_sum ?? 0);
    const prompt = row.prompt_tokens_sum ?? 0;
    const completion = row.completion_tokens_sum ?? 0;
    const cacheRead = row.cache_read_tokens_sum ?? undefined;
    const cacheCreation = row.cache_creation_tokens_sum ?? undefined;

    return {
      llmDurationMs: llmDurationMs > 0 ? llmDurationMs : undefined,
      tokens: {
        prompt,
        completion,
        cacheRead,
        cacheCreation,
        total: prompt + completion,
      },
      trackedCostUsd: row.tracked_cost_usd_sum ?? undefined,
    };
  } catch {
    return {};
  } finally {
    db?.close();
  }
}
