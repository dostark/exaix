/**
 * @module StaticOverlay
 * @path packages/model-registry/src/static_overlay.ts
 * @description Per-model pricing and context window overrides for the Solo tier.
 *   Each entry carries a verifiedAt timestamp and sourceUrl for provenance tracking.
 *   Keys are "provider:model" pairs. When an overlay entry exists, it takes
 *   precedence over IProviderMetadata's own reported contextWindow.
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/default_model_registry.ts, packages/core/src/types/constants.ts]
 */

export interface IOverlayEntry {
  inputPerMtok?: number;
  outputPerMtok?: number;
  contextWindow?: number;
  /** Max output tokens where the provider's list endpoint omits it. */
  maxOutputTokens?: number;
  /** Capability flags for thin endpoints (OpenAI list, Ollama tags). */
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  verifiedAt: number;
  sourceUrl: string;
}

export type StaticOverlay = Record<string, IOverlayEntry>;

const VERIFIED_AT_TIMESTAMP = 1_720_000_000_000;

export const STATIC_OVERLAY: StaticOverlay = {
  "openai:gpt-4o-mini": {
    inputPerMtok: 0.15,
    outputPerMtok: 0.60,
    contextWindow: 128_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://openai.com/api/pricing/",
  },
  "openai:gpt-4o": {
    inputPerMtok: 2.50,
    outputPerMtok: 10.00,
    contextWindow: 128_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://openai.com/api/pricing/",
  },
  "anthropic:claude-sonnet-5": {
    inputPerMtok: 3.00,
    outputPerMtok: 15.00,
    contextWindow: 1_000_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://anthropic.com/pricing/",
  },
  "anthropic:claude-3-7-sonnet": {
    inputPerMtok: 3.00,
    outputPerMtok: 15.00,
    contextWindow: 200_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://anthropic.com/pricing/",
  },
  "google:gemini-2.5-flash": {
    inputPerMtok: 0.075,
    outputPerMtok: 0.30,
    contextWindow: 1_000_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://cloud.google.com/vertex-ai/generative-ai/pricing/",
  },
};

/** Look up a "provider:model" overlay entry for curated defaults omitted by list endpoints. */
export function getOverlayEntry(provider: string, model: string): IOverlayEntry | undefined {
  return STATIC_OVERLAY[`${provider}:${model}`];
}
