/**
 * @module IDogfoodContext
 * @path packages/core/src/types/i_dogfood_context.ts
 * @description Shared, config-free contracts for the Phase 176 dogfood context port: the
 * bounded-context handle a launch consumer requests before spawning a child, and the
 * read-only interface `exactl request inspect` uses over captured records. Flow,
 * execution, session and CLI code consume these interfaces; they never import daemon
 * implementations directly.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/dogfood_context.ts]
 */

import type { ContextConnectionCloseReason } from "./enums.ts";
import type { ContextRecord, ContextRecordSummary, ContextRecordSurface } from "@exaix/schemas";

/** Trusted input a launch consumer supplies when requesting a bounded context supplement.
 *  Every field is execution-local and daemon-resolved — never caller-supplied scope. */
export interface IDogfoodContextInput {
  executionTraceId: string;
  parentTraceId: string;
  stepId: string;
  sequence: number;
  turn: number;
  attempt: number;
  surface: ContextRecordSurface;
  /** Resolved provider:model, supplied by the trusted caller. */
  model: string;
  originalPrompt: string;
  /** Step Actions + Architecture Notes, or the step text if absent. */
  queryText: string;
  acceptanceCriteria: readonly string[];
}

/** Returned to the launch consumer after `prepare`. `connectionId` is opaque to flow/
 *  request authors and is never persisted alongside the prompt. */
export interface IDogfoodContextHandle {
  recordId: string;
  prompt: string;
  connectionId?: string;
}

/** Config-free at the package boundary: the app-created implementation closes over a
 *  trusted scope (portal alias/canonical roots, allowed record ids, role, expiry, parent
 *  identity) and accepts no scope overrides from `prepare`'s input. */
export interface IDogfoodContextPort {
  prepare(input: IDogfoodContextInput, signal?: AbortSignal): Promise<IDogfoodContextHandle>;
  close(recordId: string, reason: ContextConnectionCloseReason): Promise<void>;
}

/** Read-only access to immutable capture records — never recomputes context, never
 *  invokes a retriever/provider/analyzer. */
export interface IContextInspectionReader {
  list(traceId: string): Promise<readonly ContextRecordSummary[]>;
  read(traceId: string, recordId: string): Promise<ContextRecord>;
}
