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
  /**
   * Parse a source-specific raw input into a validated ExecutionTriggerEnvelope.
   * Throws on malformed or unparseable input.
   */
  parse(rawInput: TRawInput): Promise<ExecutionTriggerEnvelope>;
}

export interface ITriggerIngestionService {
  /**
   * Ingest a validated trigger envelope.
   * Returns ITriggerDispatchResult (never throws on validation errors — those produce accepted: false).
   * Throws only on runtime/system errors (DB failure, config error).
   */
  ingest(trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult>;
}

export interface ITriggerPolicyGate {
  /**
   * Evaluate a trigger envelope against all active policies:
   * 1. Idempotency check
   * 2. Source authorization
   * 3. Payload schema validation
   * 4. Rate limiting
   * Never throws — returns TTriggerDecision with accepted: true/false.
   */
  evaluate(trigger: ExecutionTriggerEnvelope): Promise<TTriggerDecision>;
}

export interface ITriggerDispatchResult {
  triggerId: string;
  accepted: boolean;
  resultingTraceId?: string;
  resultingRequestId?: string;
  disposition: TriggerDisposition;
}

/**
 * Ledger for idempotency-key deduplication.
 * Implementations may use SQLite (production) or in-memory Map (testing).
 */
export interface IIdempotencyLedger {
  isDuplicate(keyHash: string): Promise<boolean>;
  record(keyHash: string, triggerId: string, accepted: boolean): Promise<void>;
}
