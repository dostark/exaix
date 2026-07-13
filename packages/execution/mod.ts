/**
 * @module Execution
 * @path packages/execution/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer Services
 * @description Barrel for @exaix/execution.
 */

export * from "./src/agent_runner.ts";
export * from "./src/agent_executor.ts";
export * from "./src/execution_context_service.ts";
export * from "./src/blueprint_service.ts";
export * from "./src/prompt_builder.ts";
export * from "./src/git_audit_service.ts";
export * from "./src/output_parser.ts";
export * from "./src/guardrail_runner.ts";
export * from "./src/strategies/execution_strategy.ts";
export * from "./src/strategies/strategy_registry.ts";
export * from "./src/strategies/legacy_strategy.ts";
export * from "./src/strategies/react_loop_strategy.ts";
export * from "./src/strategies/mcp_agent_strategy.ts";
export * from "./src/confidence_scorer.ts";
export * from "./src/types.ts";
export * from "./src/reflexive_agent.ts";
export * from "./src/execution_loop.ts";
export * from "./src/context/context_segment.ts";
export * from "./src/context/context_budget_manager.ts";
export * from "./src/context/context_budget_event_types.ts";
export * from "./src/context/context_compactor.ts";
export * from "./src/context/snapshot_store.ts";
