/**
 * @module CatalogAdapterErrors
 * @path packages/model-registry/src/adapters/errors.ts
 * @description Phase 135 Step 3 (§6.1) — typed errors an IProviderCatalogAdapter
 *   throws on fetch failure, mapped by the scheduler to registry_refresh_audit
 *   outcomes (auth_error | http_error | parse_error). Messages NEVER embed the API
 *   key (§8.2).
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/adapters/i_provider_catalog_adapter.ts]
 */

/** Base class for all catalog-adapter fetch failures. */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

/** Provider rejected the credential (HTTP 401/403). Maps to audit outcome auth_error. */
export class CatalogAuthError extends CatalogError {
  constructor(provider: string, status: number) {
    super(`${provider} catalog fetch rejected the credential (HTTP ${status}).`);
    this.name = "CatalogAuthError";
  }
}

/** Non-auth HTTP failure (5xx / unexpected status). Maps to audit outcome http_error. */
export class CatalogHttpError extends CatalogError {
  constructor(provider: string, status: number) {
    super(`${provider} catalog fetch failed with HTTP ${status}.`);
    this.name = "CatalogHttpError";
  }
}

/** Response body failed schema validation. Maps to audit outcome parse_error. */
export class CatalogParseError extends CatalogError {
  constructor(provider: string, detail: string) {
    super(`${provider} catalog payload failed validation: ${detail}`);
    this.name = "CatalogParseError";
  }
}
