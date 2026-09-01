/**
 * @module EmbeddingProviderBootstrap
 * @path apps/common/embedding_provider_bootstrap.ts
 * @description Builds the shared IEmbeddingProvider from config.memory.embedding. Used by
 * both the daemon and exactl composition roots so their provider-selection logic can't
 * drift apart the way it previously did (exactl never built one at all).
 * @architectural-layer Application
 * @related-files [apps/daemon/main.ts, apps/exactl/src/init.ts, packages/ai/src/embeddings/embedding_provider_factory.ts]
 */

import { ProviderType } from "@exaix/core";
import { createEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider_factory.ts";
import type { IEmbeddingProviderConfig } from "@exaix/ai/embeddings/embedding_provider_factory.ts";
import type { IEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider.ts";
import type { Config } from "@exaix/schemas/config.ts";

export function createMemoryEmbeddingProvider(config: Config): IEmbeddingProvider {
  const embCfg = config.memory?.embedding;
  const providerType = embCfg?.provider ?? ProviderType.OLLAMA;
  let providerConfig: IEmbeddingProviderConfig;
  switch (providerType) {
    case ProviderType.OPENAI:
      providerConfig = { provider: ProviderType.OPENAI, apiKey: embCfg?.apiKey ?? "", model: embCfg?.model };
      break;
    case ProviderType.LLAMACPP:
      providerConfig = {
        provider: ProviderType.LLAMACPP,
        model: embCfg?.model,
        baseUrl: embCfg?.baseUrl,
        chunkSize: embCfg?.chunkSize,
      };
      break;
    default:
      providerConfig = {
        provider: ProviderType.OLLAMA,
        model: embCfg?.model,
        baseUrl: embCfg?.baseUrl,
        chunkSize: embCfg?.chunkSize,
        timeoutMs: embCfg?.timeoutMs,
      };
  }
  return createEmbeddingProvider(providerConfig);
}
