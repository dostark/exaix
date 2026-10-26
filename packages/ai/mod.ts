/**
 * @module AIPackage
 * @path packages/ai/mod.ts
 * @ungrounded
 * @architectural-layer AI
 * @related-files []
 * @description Package entrypoint for @exaix/ai. This package exports shared AI constants and facades for AI provider utilities.
 */

export * from "./src/constants.ts";
export * from "./src/types.ts";
export * from "./src/errors.ts";
export * from "./src/providers.ts";
export * from "./src/provider_factory.ts";
export * from "./src/traced_provider.ts";
export * from "./src/recording_lane_provider.ts";
export * from "./src/provider_registry.ts";
export * from "./src/provider_model_info.ts";
export * from "./src/provider_selector.ts";
export * from "./src/routing/provider_routing_strategy.ts";
export * from "./src/routing/default_routing_strategy.ts";
export * from "./src/i_resolution_strategy.ts";
export * from "./src/provider_common_utils.ts";
export * from "./src/openai_responses_wire.ts";
export * from "./src/provider_api_key.ts";
export * from "./src/llm_client.ts";
export * from "./src/circuit_breaker.ts";
export * from "./src/rate_limited_provider.ts";
export * from "./src/factories/abstract_provider_factory.ts";
export * from "./src/embeddings/embedding_provider.ts";
export * from "./src/embeddings/embedding_errors.ts";
export * from "./src/embeddings/embedding_provider_factory.ts";
export * from "./src/resolve_agent_role_model.ts";
export * from "./src/model_resolver.ts";
export * from "./src/effort_resolver.ts";
export * from "./src/bindings/binding_types.ts";
export * from "./src/bindings/binding_layers.ts";
export * from "./src/bindings/binding_validation.ts";
export * from "./src/bindings/net_grant.ts";
export * from "./src/bindings/overlay_file.ts";
export * from "./src/bindings/run_bindings_store.ts";
export * from "./src/bindings/binding_resolver.ts";
export * from "./src/bindings/model_binding_service.ts";
export * from "./src/native_conversation_budget.ts";
export * from "./src/provider_call_options.ts";
export * from "./src/compatible_usage.ts";
export * from "./src/structured_output.ts";

export {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  DEFAULT_AI_TEMPERATURE_MAX,
  DEFAULT_AI_TEMPERATURE_MIN,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_FAST_MODEL_NAME,
  DEFAULT_LOCAL_MODEL_NAME,
  DEFAULT_MOCK_MODEL,
  DEFAULT_MOCK_STRATEGY,
  MOCK_DELAY_MS,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
} from "@exaix/core";

export type {
  BindingField,
  BindingLayer,
  BindingOutcome,
  IBindingCatalog,
  IBindingIssue,
  IBindingLayers,
  IBindingRunSnapshot,
  IBindingSpec,
  IBindingStepRef,
  IResolvedBinding,
  IStepPin,
} from "@exaix/schemas";
