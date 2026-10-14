/**
 * @module ProviderModelInfo
 * @path packages/ai/src/provider_model_info.ts
 * @description Reads optional model catalogs and applies provider-level fallbacks.
 * @architectural-layer AI
 * @dependencies [@exaix/core/types, ./provider_registry.ts]
 * @related-files [packages/ai/src/model_resolver.ts, packages/model-registry/src/default_model_registry.ts]
 */
import type { Opt, Reason } from "@exaix/core/types";
import type { IProviderMetadata, IProviderModelInfo } from "./provider_registry.ts";

/** Returns catalog data when available. Catalog implementations journal their own lookup failures. */
export async function readProviderModelInfo(
  metadata: Opt<IProviderMetadata, Reason.OptionalContext>,
  model: string,
): Promise<IProviderModelInfo | undefined> {
  try {
    return await metadata?.modelInfo?.(model);
  } catch {
    return undefined;
  }
}

/** Resolves model-specific values without changing the registered provider metadata. */
export async function resolveProviderMetadata(metadata: IProviderMetadata, model: string): Promise<IProviderMetadata> {
  const info = await readProviderModelInfo(metadata, model);
  return {
    ...metadata,
    contextWindow: info?.contextWindow ?? metadata.contextWindow,
    costPerMtok: info?.inputPerMtok ?? metadata.costPerMtok,
    supportsThinking: info?.supportsThinking ?? metadata.supportsThinking,
    supportsEffort: info?.supportsEffort ?? metadata.supportsEffort,
  };
}
