/**
 * @module TriggerInterfaces
 * @path packages/core/src/triggers/interfaces.ts
 * @architectural-layer Core
 * @dependencies ["./schemas.ts"]
 * @related-files ["packages/core/src/triggers/schemas.ts"]
 * @description Service interfaces for the trigger adapter boundary.
 * ITriggerAdapter — per-source parsing.
 * ITriggerIngestionService — top-level ingestion orchestration.
 * ITriggerPolicyGate — policy evaluation (idempotency, source auth, payload validation, rate limiting).
 */

import type { ExecutionTriggerEnvelope, TTriggerDecision, TTriggerSource } from "./schemas.ts";
import type { TriggerDisposition } from "@exaix/core/types";

export interface ITriggerAdapter<TRawInput = never> {
  readonly source: TTriggerSource;
  /** Parses a source-specific raw input into a validated ExecutionTriggerEnvelope; throws on malformed input. */
  parse(rawInput: TRawInput): Promise<ExecutionTriggerEnvelope>;
}

export interface ITriggerIngestionService {
  /** Never throws on validation errors (those produce accepted: false) — only on
   *  runtime/system errors (DB failure, config error). */
  ingest(trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult>;
}

export interface ITriggerPolicyGate {
  /** Evaluates idempotency, source auth, payload schema, and rate limit; never throws — returns a decision. */
  evaluate(trigger: ExecutionTriggerEnvelope): Promise<TTriggerDecision>;
}

export interface ITriggerDispatchResult {
  triggerId: string;
  accepted: boolean;
  resultingTraceId?: string;
  resultingRequestId?: string;
  disposition: TriggerDisposition;
}

/** Ledger for idempotency-key deduplication; implementations may use SQLite (production) or an in-memory Map (testing). */
export interface IIdempotencyLedger {
  isDuplicate(keyHash: string): Promise<boolean>;
  record(keyHash: string, triggerId: string, accepted: boolean): Promise<void>;
}
