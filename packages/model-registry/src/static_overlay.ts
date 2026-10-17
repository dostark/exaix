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
  cacheReadPerMtok?: number;
  cacheCreationPerMtok?: number;
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
  // Short-context rates only. Prompts over 272K input tokens cost more.
  "openai:gpt-6-luna": {
    inputPerMtok: 0.10,
    outputPerMtok: 0.50,
    cacheReadPerMtok: 0.01,
    cacheCreationPerMtok: 0.125,
    verifiedAt: Date.UTC(2026, 8, 28),
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-luna",
  },
  // Peak-hour rates. Off-peak is lower, so estimates are an upper bound.
  "deepseek:deepseek-v4-pro": {
    inputPerMtok: 1.32,
    outputPerMtok: 3.96,
    cacheReadPerMtok: 0.044,
    verifiedAt: Date.UTC(2026, 8, 29),
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  "anthropic:claude-sonnet-5": {
    inputPerMtok: 3.00,
    outputPerMtok: 15.00,
    contextWindow: 1_000_000,
    verifiedAt: VERIFIED_AT_TIMESTAMP,
    sourceUrl: "https://anthropic.com/pricing/",
  },
  // `gemini-3.8-flash` on the Google AI API, standard paid tier, text.
  // The rates apply through the end of 2026 and double at the start of 2027 (see sourceUrl).
  "google:gemini-3.8-flash": {
    inputPerMtok: 0.75,
    outputPerMtok: 3.75,
    contextWindow: 1_048_576,
    verifiedAt: Date.UTC(2026, 9, 11),
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
};

/** Context windows of current models, from the OpenRouter catalog. Kept apart from STATIC_OVERLAY, so a window row never reports static pricing. */
export const STATIC_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "openai:gpt-5.6-terra": 1_050_000,
  "openai:gpt-5-mini": 400_000,
  "anthropic:claude-opus-5": 1_000_000,
};

/** Look up a "provider:model" overlay entry for curated defaults omitted by list endpoints. */
export function getOverlayEntry(provider: string, model: string): IOverlayEntry | undefined {
  return STATIC_OVERLAY[`${provider}:${model}`];
}
