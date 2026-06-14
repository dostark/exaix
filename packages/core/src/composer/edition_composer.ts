/**
 * @module EditionComposer
 * @path packages/core/src/composer/edition_composer.ts
 * @architectural-layer Core
 * @related-files []
 * @description Edition-composition contracts (Phase 115 Step 6b).
 *
 * IEditionComposer is the single attach point every deferred seam (flow-step
 * handlers, symbol extractors, guardrail runner, routing strategy, entitlement)
 * plugs into. Core ships only the empty hook — paid editions implement
 * ICapabilityModule and register through the composer.
 *
 * Registry parameters use an opaque placeholder to avoid circular deps between
 * @exaix/core and @exaix/flow / @exaix/portal. Concrete types are resolved
 * by the composer implementation at the app-entry level.
 */

/**
 * Opaque placeholder for seam-registry types.
 * Replaced with a concrete interface (e.g. IFlowStepHandlerRegistry) when
 * a capability module hook is implemented. Using an empty interface instead of
 * `unknown` satisfies the explicit-unknown style rule.
 * @ungrounded — placeholder until concrete registry types are referenced.
 */
// deno-lint-ignore no-empty-interface
export interface ISeamRegistryPlaceholder {}

/**
 * Hooks that a paid-edition capability module fills.
 * Each hook receives the corresponding seam's registry.
 * All hooks are optional — a module registers only what it provides.
 */
export interface ICapabilityModule {
  /**
   * Register flow-step handlers (e.g. Team-specific step types).
   * Called with the app's IFlowStepHandlerRegistry.
   */
  registerFlowStepHandlers?(registry: ISeamRegistryPlaceholder): void;

  /**
   * Register symbol extractors (e.g. tree-sitter extractors for non-TS langs).
   * Called with the app's ISymbolExtractorRegistry.
   */
  registerSymbolExtractors?(registry: ISeamRegistryPlaceholder): void;

  /**
   * Register a guardrail runner (Team/Enterprise guardrail enforcement).
   * Called with the app's IGuardrailRunnerRegistry.
   * @remarks Registry defined when the guardrail seam is added (future phase).
   */
  registerGuardrailRunner?(registry: ISeamRegistryPlaceholder): void;

  /**
   * Register a provider routing strategy (Team/Enterprise multi-provider routing).
   * Called with the app's IProviderRoutingStrategyRegistry.
   * @remarks Registry defined when the routing seam is added (future phase).
   */
  registerProviderRoutingStrategy?(registry: ISeamRegistryPlaceholder): void;

  /**
   * Register an entitlement layer (Enterprise RBAC).
   * Called with the app's IAuthorizer.
   * @remarks Seam defined when the RBAC phase is added (future phase).
   */
  registerEntitlement?(registry: ISeamRegistryPlaceholder): void;
}

/**
 * Edition composer — the single attach point for paid-edition capabilities.
 * Each runtime entry (daemon, exactl, agent-entrypoint) creates the appropriate
 * composer for its edition and registers the edition's capability modules.
 */
export interface IEditionComposer {
  /** Register a capability module. Order is not significant. */
  registerCapabilityModule(module: ICapabilityModule): void;
}
