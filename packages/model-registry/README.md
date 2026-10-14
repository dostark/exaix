# @exaix/model-registry

Solo-tier Model Registry floor — an implementation of `IModelRegistry` that uses
`ProviderRegistry`, static context windows, and a static pricing overlay without a
database. Context-window reads prefer the static overlay, then static context windows,
then optional provider model metadata, then provider-level metadata. OpenRouter's
provider metadata can read its cached models endpoint, with a five-second request
limit. Lookup failure uses the provider-level fallback.

## Source Files

- `src/default_model_registry.ts` — `DefaultModelRegistry`, the 13-method `IModelRegistry` floor
- `src/static_overlay.ts` — Per-model pricing and context window overrides (`STATIC_OVERLAY`)
- `src/cost_units.ts` — USD-per-million-tokens ↔ per-1K-tokens conversion helpers
- `src/errors.ts` — `RegistryNotImplementedError` for Team+ methods not in Solo
- `mod.ts` — Package entrypoint re-exports

## Dependencies

- `@exaix/core/types` — `IModelRegistry`, `ICapabilityProfile`
- `@exaix/ai` — `ProviderRegistry`, `IProviderHealthChecker`, provider model metadata
- `@exaix/schemas` — `getDefaultModels`

## Tests

See `tests/default_model_registry_test.ts` for the full test suite.
