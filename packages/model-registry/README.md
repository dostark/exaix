# @exaix/model-registry

Solo-tier Model Registry floor — an offline, zero-network, zero-DB implementation of
`IModelRegistry` that resolves models using the `ProviderRegistry`, `MODEL_CONTEXT_WINDOWS`
constants, and a static pricing overlay.

## Source Files

- `src/default_model_registry.ts` — `DefaultModelRegistry`, the 13-method `IModelRegistry` floor
- `src/static_overlay.ts` — Per-model pricing and context window overrides (`STATIC_OVERLAY`)
- `src/cost_units.ts` — USD-per-million-tokens ↔ per-1K-tokens conversion helpers
- `src/errors.ts` — `RegistryNotImplementedError` for Team+ methods not in Solo
- `mod.ts` — Package entrypoint re-exports

## Dependencies

- `@exaix/core/types` — `IModelRegistry`, `ICapabilityProfile`, `MODEL_CONTEXT_WINDOWS`
- `@exaix/ai` — `ProviderRegistry`, `IProviderHealthChecker`
- `@exaix/schemas` — `getDefaultModels`

## Tests

See `tests/default_model_registry_test.ts` for the full test suite.
