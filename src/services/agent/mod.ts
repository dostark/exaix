/**
 * @module AgentServicesIndex
 * @path src/services/agent/mod.ts
 * @description Barrel export for remaining local agent modules. Moved
 * modules (agent_runner, agent_executor, strategies) are at @exaix/execution.
 * @architectural-layer Services
 * @related-files ["packages/execution/"]
 */

export * from "./reflexive_agent.ts";
export * from "./execution_loop.ts";
