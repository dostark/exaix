/**
 * @module EvalHistory
 * @path packages/eval-history/mod.ts
 * @architectural-layer Services
 * @description Evaluation-history store + schema (Phase 100 Evaluation Framework).
 *   Relocated out of tests/scenario_framework so the `exactl eval` command can consume
 *   it without a production-to-tests dependency (the deploy-blocking layering violation).
 * @related-files [packages/eval-history/src/history_sqlite.ts, packages/eval-history/src/history_schema.ts]
 */

export { EvalSqliteStore, resolveEvalDbPath } from "./src/history_sqlite.ts";
export type { IFamilySummaryRow } from "./src/history_sqlite.ts";
export { EvalHistoryEntrySchema, getDefaultComponentVersions, StepResultSchema } from "./src/history_schema.ts";
export type { IComponentVersions, IEvalHistoryEntry, IStepResult } from "./src/history_schema.ts";
