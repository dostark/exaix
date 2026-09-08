/**
 * @module DogfoodContextSchema
 * @path packages/schemas/src/dogfood_context.ts
 * @description Immutable capture record of the exact bounded context Exaix assembled and
 * sent to a dogfood child launch: the post-redaction prompt, per-section budget/selection
 * evidence, and the granted MCP tool definitions. `promptText` is the exact Exaix-owned
 * submission, not a reconstruction; native CLI internal prompt/tools/history are always
 * `unknown` — this record never claims visibility into them.
 * @architectural-layer Schemas
 * @related-files [packages/core/src/types/i_dogfood_context.ts]
 */

import { z } from "zod";

export const CONTEXT_RECORD_SCHEMA_VERSION = 1;

/** Which production dogfood launch path produced this record. */
export const ContextRecordSurfaceSchema = z.enum(["cli_delegate", "session_delegate_cycle"]);
export type ContextRecordSurface = z.infer<typeof ContextRecordSurfaceSchema>;

/** Whether the final token count is a real tokenizer count or a conservative estimate. */
export const ContextRecordTokenSourceSchema = z.enum(["counted", "heuristic"]);
export type ContextRecordTokenSource = z.infer<typeof ContextRecordTokenSourceSchema>;

/** Budget/selection evidence for one prompt section (a `PromptBudgetAllocator` section,
 *  or a capture/report subsection like `portalKnowledgeCrucial`/`memoryCrucial`). */
export const ContextRecordSectionSchema = z.object({
  label: z.string().min(1),
  allocatorSection: z.string().min(1),
  allocatedTokens: z.number().int().nonnegative(),
  actualTokens: z.number().int().nonnegative(),
  selectedSourceIds: z.array(z.string()),
  selectedScores: z.array(z.number()),
  unavailableReason: z.string().optional(),
  omittedIds: z.array(z.string()),
  truncated: z.boolean(),
}).strict();
export type ContextRecordSection = z.infer<typeof ContextRecordSectionSchema>;

/** One MCP tool definition actually granted to the child for this record; empty when
 *  no tool transport is wired for a given launch. */
export const ContextRecordToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  schemaDigest: z.string().min(1),
}).strict();
export type ContextRecordTool = z.infer<typeof ContextRecordToolSchema>;

const STEP_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export const ContextRecordSchema = z.object({
  schemaVersion: z.literal(CONTEXT_RECORD_SCHEMA_VERSION),
  recordId: z.string().uuid(),
  executionTraceId: z.string().uuid(),
  parentTraceId: z.string().uuid(),
  stepId: z.string().regex(STEP_ID_PATTERN),
  sequence: z.number().int().positive(),
  turn: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  surface: ContextRecordSurfaceSchema,
  model: z.string().min(1),
  timestamp: z.string().datetime(),
  /** SHA-256 (hex) of the exact original-input UTF-8 bytes, before any assembly. */
  originalInputSha256: z.string().length(64),
  /** Exact post-redaction Exaix submission — the same bytes sent to the child. */
  promptText: z.string(),
  /** SHA-256 (hex) of `promptText`'s exact UTF-8 bytes. */
  promptSha256: z.string().length(64),
  originalTokenCount: z.number().int().nonnegative(),
  finalTokenCount: z.number().int().nonnegative(),
  tokenSource: ContextRecordTokenSourceSchema,
  effectiveInputLimit: z.number().int().positive(),
  effectiveReserveLimit: z.number().int().nonnegative(),
  sections: z.array(ContextRecordSectionSchema),
  tools: z.array(ContextRecordToolSchema),
  /** Always `exaix_submission_only` — this record never claims to capture native CLI
   *  internal state. */
  visibility: z.literal("exaix_submission_only"),
  nativePrompt: z.literal("unknown"),
  nativeTools: z.literal("unknown"),
  nativeHistory: z.literal("unknown"),
}).strict();
export type ContextRecord = z.infer<typeof ContextRecordSchema>;

/** Listing view for `exactl request inspect` without `--record` — one row per capture,
 *  ordered by sequence/turn/attempt/timestamp/recordId. */
export const ContextRecordSummarySchema = z.object({
  recordId: z.string().uuid(),
  executionTraceId: z.string().uuid(),
  parentTraceId: z.string().uuid(),
  stepId: z.string().regex(STEP_ID_PATTERN),
  sequence: z.number().int().positive(),
  turn: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  surface: ContextRecordSurfaceSchema,
  model: z.string().min(1),
  timestamp: z.string().datetime(),
}).strict();
export type ContextRecordSummary = z.infer<typeof ContextRecordSummarySchema>;

/** Derives the listing summary from a full record — every summary field is a direct
 *  projection, so this can never drift from the source of truth. */
export function toContextRecordSummary(record: ContextRecord): ContextRecordSummary {
  return {
    recordId: record.recordId,
    executionTraceId: record.executionTraceId,
    parentTraceId: record.parentTraceId,
    stepId: record.stepId,
    sequence: record.sequence,
    turn: record.turn,
    attempt: record.attempt,
    surface: record.surface,
    model: record.model,
    timestamp: record.timestamp,
  };
}
