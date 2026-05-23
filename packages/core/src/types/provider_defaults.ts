/**
 * @module ProviderDefaults
 * @path packages/core/src/types/provider_defaults.ts
 * @related-files []
 * @architectural-layer Core
 * @description Interface and registry for provider-owned default values. Enables dependency
 * inversion so @exaix/core does not import from concrete provider packages. Provider packages
 * implement IProviderDefaults and register at bootstrap time.
 */

/**
 * Minimum set of defaults every concrete AI provider must advertise.
 * Provider packages define a `*_DEFAULTS` object and register it via ProviderDefaultsRegistry.
 */
export interface IProviderDefaults {
  readonly defaultModel: string;
  readonly defaultEndpoint: string;
  readonly defaultTimeoutMs: number;
  readonly defaultRetryMaxAttempts: number;
  readonly defaultRetryBackoffMs: number;
}

/**
 * Static registry that maps provider-type strings to their IProviderDefaults implementation.
 * Populated at application bootstrap before any provider call is made.
 */
export class ProviderDefaultsRegistry {
  private static readonly _registry = new Map<string, IProviderDefaults>();

  static register(providerType: string, defaults: IProviderDefaults): void {
    this._registry.set(providerType, defaults);
  }

  static get(providerType: string): IProviderDefaults | undefined {
    return this._registry.get(providerType);
  }

  static getDefaultModel(providerType: string): string | undefined {
    return this._registry.get(providerType)?.defaultModel;
  }

  static getDefaultEndpoint(providerType: string): string | undefined {
    return this._registry.get(providerType)?.defaultEndpoint;
  }

  static getDefaultTimeoutMs(providerType: string): number | undefined {
    return this._registry.get(providerType)?.defaultTimeoutMs;
  }

  static getDefaultRetryMaxAttempts(providerType: string): number | undefined {
    return this._registry.get(providerType)?.defaultRetryMaxAttempts;
  }

  static getDefaultRetryBackoffMs(providerType: string): number | undefined {
    return this._registry.get(providerType)?.defaultRetryBackoffMs;
  }

  static isRegistered(providerType: string): boolean {
    return this._registry.has(providerType);
  }

  static clear(): void {
    this._registry.clear();
  }
}
