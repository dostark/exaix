/**
 * @module StrategyRegistryTest
 * @path tests/agents/strategy_registry_test.ts
 * @description Unit tests for StrategyRegistry and IExecutionStrategy registration.
 */

import { assertEquals, assertFalse, assertThrows } from "@std/assert";
import { StrategyRegistry } from "../../src/services/agent/strategies/strategy_registry.ts";
import type { IExecutionStrategy } from "../../src/services/agent/strategies/execution_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_executor.ts";

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
  assertThrows(
    () => registry.resolve("unknown"),
    Error,
    "Execution strategy not found",
  );
});

/**
 * Mock strategy with optional dispose() lifecycle method.
 * Used to verify IExecutionStrategy.dispose?() optional-chaining contract (Step 61.6).
 */
class MockDisposableStrategy implements IExecutionStrategy {
  disposeCalled = false;

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
      description: "disposable mock result",
      tool_calls: 0,
      execution_time_ms: 0,
    });
  }

  dispose(): void {
    this.disposeCalled = true;
  }
}

Deno.test("StrategyRegistry: dispose?() optional-chaining calls dispose on disposable strategies", () => {
  const registry = new StrategyRegistry();
  const disposable = new MockDisposableStrategy("disposable");
  const nonDisposable = new MockStrategy("nondisposable");

  registry.register(disposable);
  registry.register(nonDisposable);

  // This uses the type-safe optional-chaining pattern that requires dispose?(): void on IExecutionStrategy
  for (const strategy of registry.all()) {
    strategy.dispose?.();
  }

  assertEquals(disposable.disposeCalled, true, "dispose() should be called on disposable strategy");
  assertFalse("disposeCalled" in nonDisposable, "non-disposable strategy should have no disposeCalled field");
});

Deno.test("StrategyRegistry: dispose?() optional-chaining is safe when no strategies implement dispose", () => {
  const registry = new StrategyRegistry();
  registry.register(new MockStrategy("a"));
  registry.register(new MockStrategy("b"));

  // Must not throw even though no strategy implements dispose()
  let threw = false;
  try {
    for (const strategy of registry.all()) {
      strategy.dispose?.();
    }
  } catch {
    threw = true;
  }
  assertFalse(threw, "dispose?() optional-chaining must not throw when dispose is absent");
});
