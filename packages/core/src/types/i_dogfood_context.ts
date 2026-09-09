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
import type { ContextRecord, ContextRecordSummary, ContextRecordSurface, ContextRecordTool } from "@exaix/schemas";

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

/** Launch-only, ephemeral connection metadata for the child's live MCP session — never
 *  persisted to a ContextRecord or disk; `bearerToken` reaches the child only as the
 *  value of the `bearerEnvVar`-named env var in trusted launch construction. */
export interface IDogfoodContextConnection {
  connectionId: string;
  /** `http://127.0.0.1:<port>/mcp` — loopback only, OS-assigned port. */
  endpoint: string;
  /** Name of the env var the bearer credential is carried under (e.g. `EXAIX_CONTEXT_BEARER`). */
  bearerEnvVar: string;
  bearerToken: string;
  expiresAt: string;
  /** The exact three tool definitions the server grants, captured verbatim in the capture record. */
  tools: readonly ContextRecordTool[];
}

/** Returned to the launch consumer after `prepare`. `connectionId` is opaque to flow/
 *  request authors and is never persisted alongside the prompt. `connection` is present
 *  only when a live MCP endpoint was started for this launch. */
export interface IDogfoodContextHandle {
  recordId: string;
  prompt: string;
  connectionId?: string;
  connection?: IDogfoodContextConnection;
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
  /** Bounded lookup of every record whose `parentTraceId` matches — for a caller who only
   *  knows the governing (parent) trace, not the per-launch (child) execution trace. Scans
   *  only the store's own trusted Execution root, never a caller-supplied path. */
  listByParentTrace(parentTraceId: string): Promise<readonly ContextRecordSummary[]>;
}
