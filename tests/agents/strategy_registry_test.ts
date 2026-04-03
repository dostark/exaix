/**
 * @module StrategyRegistryTest
 * @path tests/agents/strategy_registry_test.ts
 * @description Unit tests for StrategyRegistry and IExecutionStrategy registration.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { StrategyRegistry } from "../../src/services/agent/strategies/strategy_registry.ts";
import { IExecutionStrategy } from "../../src/services/agent/strategies/execution_strategy.ts";
import { IAgentFileBlueprint } from "../../src/services/agent/agent_executor.ts";
import {
  IAgentExecutionOptions,
  IChangesetResult,
  IExecutionContext,
} from "../../src/shared/schemas/agent_executor.ts";

/**
 * Mock strategy for tests
 */
class MockStrategy implements IExecutionStrategy {
  constructor(public readonly name: string) {}

  execute(
    _blueprint: IAgentFileBlueprint,
    _context: IExecutionContext,
    _options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    return Promise.resolve({
      branch: "test-branch",
      commit_sha: "test-sha",
      files_changed: [],
      description: "mock result",
      tool_calls: 0,
      execution_time_ms: 0,
    });
  }
}

Deno.test("StrategyRegistry Tests - Mock strategy registration and resolution", () => {
  const registry = new StrategyRegistry();
  const mock1 = new MockStrategy("mcp");
  const mock2 = new MockStrategy("react");

  registry.register(mock1);
  registry.register(mock2);

  assertEquals(registry.list(), ["mcp", "react"]);
  assertEquals(registry.resolve("mcp"), mock1);
  assertEquals(registry.resolve("react"), mock2);
});

Deno.test("StrategyRegistry Tests - Should throw for unknown strategy", () => {
  const registry = new StrategyRegistry();
  assertThrows(() => registry.resolve("unknown"), Error, "Execution strategy not found: unknown");
});
