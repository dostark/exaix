/**
 * @module AgentServicesIndex
 * @path src/services/agent/mod.ts
 * @description Barrel export for agent service modules. agent_runner and
 * agent_executor re-exported from @exaix/execution.
 * @architectural-layer Services
 * @related-files ["packages/execution/"]
 */

export * from "@exaix/execution";
export * from "./reflexive_agent.ts";
export * from "./execution_loop.ts";
