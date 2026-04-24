/**
 * @module OllamaEmbeddingClient
 * @path src/ai/providers/ollama_embedding_client.ts
 * @description IEmbeddingProvider implementation that calls Ollama's
 * /api/embed endpoint with localhost-only SSRF validation.
 * @architectural-layer AI
 * @dependencies [src/ai/embeddings/embedding_provider.ts, src/ai/embeddings/embedding_errors.ts, src/shared/constants.ts]
 * @related-files [src/ai/embeddings/embedding_provider_factory.ts, src/shared/interfaces/i_memory_embedding_service.ts]
 */

import type { IEmbeddingProvider } from "../embeddings/embedding_provider.ts";
import type { JSONValue } from "../../shared/types/json.ts";
import { EmbeddingError } from "../embeddings/embedding_errors.ts";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_EMBED_CHUNK_SIZE,
  DEFAULT_OLLAMA_TIMEOUT_MS,
} from "../../shared/constants.ts";

/**
 * Ollama /api/embed response validated by Zod before consumption (OWASP A08).
 */
/**
 * Raw Ollama /api/embed HTTP response body structure.
 */
interface IOllamaRawEmbedResponse {
  embeddings?: JSONValue;
  error?: JSONValue;
}

/**
 * Ollama /api/embed response validated before consumption (OWASP A08).
 */
const ZOllamaEmbedResponse = {
  parse: (body: JSONValue): { embeddings: number[][] } => {
    if (typeof body !== "object" || body === null) {
      throw new EmbeddingError(
        "EMBEDDING_FAILED",
        "Ollama response is not an object",
      );
    }
    const raw = body as IOllamaRawEmbedResponse;
    if (!("embeddings" in raw) || !Array.isArray(raw.embeddings)) {
      throw new EmbeddingError(
        "EMBEDDING_FAILED",
        "Ollama response missing embeddings array",
      );
    }
    const embeddings = raw.embeddings as JSONValue[];
    for (const entry of embeddings) {
      if (!Array.isArray(entry) || !(entry as JSONValue[]).every((v) => typeof v === "number")) {
        throw new EmbeddingError(
          "EMBEDDING_FAILED",
          "Ollama embeddings entry is not a number array",
        );
      }
    }
    return { embeddings: embeddings as number[][] };
  },
};

export interface IOllamaEmbeddingConfig {
  model?: string;
  baseUrl?: string;
  chunkSize?: number;
  timeoutMs?: number;
}

export class OllamaEmbeddingClient implements IEmbeddingProvider {
  readonly providerId = "ollama";
  readonly dimension: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly chunkSize: number;
  private readonly timeoutMs: number;

  constructor(config?: IOllamaEmbeddingConfig) {
    const rawUrl = config?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;

    // SSRF mitigation — localhost only (OWASP A10)
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // Strip IPv6 brackets
    const allowedHosts = ["localhost", "127.0.0.1", "::1"];
    if (!allowedHosts.includes(hostname)) {
      throw new EmbeddingError(
        "INVALID_CONFIG",
        `Ollama baseUrl must resolve to localhost only (got "${parsed.hostname}"). Use a local embedding provider.`,
      );
    }

    this.baseUrl = rawUrl;
    this.model = config?.model ?? "nomic-embed-text";
    this.chunkSize = config?.chunkSize ?? DEFAULT_OLLAMA_EMBED_CHUNK_SIZE;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    // nomic-embed-text uses 768 dimensions
    this.dimension = 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Batch if texts exceeds chunkSize
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.chunkSize) {
      batches.push(texts.slice(i, i + this.chunkSize));
    }

    const results: number[][] = [];
    for (const batch of batches) {
      const vectors = await this.embedBatch(batch);
      results.push(...vectors);
    }
    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const errorMsg = (body as IOllamaRawEmbedResponse).error ?? `HTTP ${response.status}`;
        if (typeof errorMsg === "string" && errorMsg.includes("not found")) {
          throw new EmbeddingError("MODEL_NOT_FOUND", `Ollama model "${this.model}" not found`);
        }
        throw new EmbeddingError("EMBEDDING_FAILED", `Ollama error: ${errorMsg}`);
      }

      const raw = await response.json();
      const parsed = ZOllamaEmbedResponse.parse(raw);
      return parsed.embeddings;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof EmbeddingError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new EmbeddingError("TIMEOUT", `Embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw new EmbeddingError(
        "EMBEDDING_FAILED",
        `Ollama embed request failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}
