/**
 * @module AgentExecutorStrategyRegistryTest
 * @path tests/load/agent_executor_strategy_swap_test.ts
 * @description Verifies ReAct and MCP strategy registry entries stay distinct and stable.
 * @architectural-layer Integration
 * @related-files [packages/execution/src/strategies/strategy_registry.ts, packages/execution/src/agent_composer.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { ExecutionStrategyName } from "@exaix/core";
import { StrategyRegistry } from "@exaix/execution";
import type { IExecutionStrategy } from "@exaix/execution";
import type { IChangesetResult } from "@exaix/schemas/agent_composer.ts";

function stubStrategy(name: ExecutionStrategyName): IExecutionStrategy {
  return {
    name,
    execute: () =>
      Promise.resolve(
        {
          branch: "feat/strategy-test",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: name,
          tool_calls: 0,
          execution_time_ms: 0,
        } satisfies IChangesetResult,
      ),
  };
}

Deno.test("Strategy registry resolves ReAct and MCP as distinct stable strategies", () => {
  const registry = new StrategyRegistry();
  const react = stubStrategy(ExecutionStrategyName.REACT);
  const mcp = stubStrategy(ExecutionStrategyName.MCP);
  registry.register(react);
  registry.register(mcp);

  assertEquals(registry.list(), [ExecutionStrategyName.REACT, ExecutionStrategyName.MCP]);
  assertNotEquals(registry.resolve(ExecutionStrategyName.REACT), registry.resolve(ExecutionStrategyName.MCP));
  assertEquals(registry.resolve(ExecutionStrategyName.REACT), react);
  assertEquals(registry.resolve(ExecutionStrategyName.MCP), mcp);
  assertEquals(registry.resolve(ExecutionStrategyName.REACT), registry.resolve(ExecutionStrategyName.REACT));
});

Deno.test("Strategy registry supports an isolated ReAct entry", () => {
  const registry = new StrategyRegistry();
  const react = stubStrategy(ExecutionStrategyName.REACT);
  registry.register(react);

  assertEquals(registry.list(), [ExecutionStrategyName.REACT]);
  assertEquals(registry.resolve(ExecutionStrategyName.REACT), react);
});
