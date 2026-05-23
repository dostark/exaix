/**
 * @module AiErrors
 * @path packages/ai/src/errors.ts
 * @description Specialized error classes for the AI layer, specifically for provider factory failures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/lazy_provider.ts, packages/ai/src/provider_api_key.ts]
 */
export class ProviderFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFactoryError";
  }
}
