/**
 * @module EmbeddingErrors
 * @path packages/ai/src/embeddings/embedding_errors.ts
 * @description Typed error class for embedding provider operations with
 * structured error codes for downstream handling.
 * @architectural-layer AI
 * @ungrounded
 * @related-files [packages/ai/src/embeddings/embedding_provider_factory.ts, packages/ai-ollama/src/ollama_embedding_client.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/**
 * Structured error codes for embedding operations.
 */
export type EmbeddingErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "EMBEDDING_FAILED"
  | "TIMEOUT"
  | "UNKNOWN_PROVIDER"
  | "INVALID_CONFIG"
  | "EMBEDDING_CANCELLED";

/** Typed error for embedding provider operations; carries a structured error code
 *  for programmatic handling by callers. */
export class EmbeddingError extends Error {
  override readonly name = "EmbeddingError";

  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
    cause?: Opt<Error, Reason.OptionalContext>,
  ) {
    super(message);
    if (cause) {
      this.cause = cause;
    }
  }
}
