/**
 * @module AiErrors
 * @path src/ai/errors.ts
 * @description Specialized error classes for the AI layer, specifically for provider factory failures.
 * @architectural-layer AI
 * @related-files [src/ai/factories/abstract_provider_factory.ts]
 */
export class ProviderFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFactoryError";
  }
}
