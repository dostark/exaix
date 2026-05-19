/**
 * @module OllamaPackageEmbeddingClient
 * @path packages/ai-ollama/src/ollama_embedding_client.ts
 * @description Ollama embedding client owned by the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/ollama_embedding_client.ts]
 */

import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_EMBED_CHUNK_SIZE, DEFAULT_OLLAMA_TIMEOUT_MS } from "./constants.ts";
import { EmbeddingError } from "@exaix/ai/embeddings/embedding_errors.ts";
import type { IEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider.ts";
import type { JSONValue } from "@exaix/core";

interface IOllamaRawEmbedResponse {
  embeddings?: JSONValue;
  error?: JSONValue;
}

const ZOllamaEmbedResponse = {
  parse: (body: JSONValue): { embeddings: number[][] } => {
    if (typeof body !== "object" || body === null) {
      throw new EmbeddingError("EMBEDDING_FAILED", "Ollama response is not an object");
    }
    const raw = body as IOllamaRawEmbedResponse;
    if (!("embeddings" in raw) || !Array.isArray(raw.embeddings)) {
      throw new EmbeddingError("EMBEDDING_FAILED", "Ollama response missing embeddings array");
    }
    const embeddings = raw.embeddings as JSONValue[];
    for (const entry of embeddings) {
      if (!Array.isArray(entry) || !(entry as JSONValue[]).every((value) => typeof value === "number")) {
        throw new EmbeddingError("EMBEDDING_FAILED", "Ollama embeddings entry is not a number array");
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
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
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
    this.dimension = 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

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
      const parsed = ZOllamaEmbedResponse.parse(raw as JSONValue);
      return parsed.embeddings;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof EmbeddingError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new EmbeddingError("TIMEOUT", `Embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw new EmbeddingError(
        "EMBEDDING_FAILED",
        `Ollama embed request failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
