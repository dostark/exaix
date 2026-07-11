/**
 * @module AdapterRegistry
 * @path packages-team/model-registry-live/src/adapters/adapter_registry.ts
 * @description Phase 135 Step 3 — boot-time static registry of provider-catalog
 *   adapters (pattern-copy of ProviderDefaultsRegistry). The Team module's bootstrap
 *   populates it; the refresh scheduler (Step 5) and the explicit-validation strategy
 *   (Step 3) look adapters up by provider type.
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry]
 * @related-files [packages/core/src/types/provider_defaults.ts, packages-team/model-registry-live/src/adapters/openrouter_catalog_adapter.ts]
 */
import type { IProviderCatalogAdapter } from "@exaix/model-registry";

/** Maps provider-type strings to their catalog adapter. Populated at bootstrap. */
export class AdapterRegistry {
  private readonly registry = new Map<string, IProviderCatalogAdapter>();

  register(adapter: IProviderCatalogAdapter): void {
    this.registry.set(adapter.provider, adapter);
  }

  get(provider: string): IProviderCatalogAdapter | undefined {
    return this.registry.get(provider);
  }

  getAll(): IProviderCatalogAdapter[] {
    return [...this.registry.values()];
  }

  isRegistered(provider: string): boolean {
    return this.registry.has(provider);
  }

  clear(): void {
    this.registry.clear();
  }
}
