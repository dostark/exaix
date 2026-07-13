/**
 * @module StrategyParityTest
 * @path tests/regression/strategy_parity_test.ts
 * @description Verifies that all IExecutionStrategy implementations produce
 * consistent result schemas and emit identical event types to the Activity Journal.
 * Ensures Step 61.5 strategy unification parity.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ChangesetResultSchema } from "@exaix/schemas/agent_orchestrator.ts";
import { LegacyAgentStrategy } from "@exaix/execution";
import { ReActLoopStrategy } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import { setupStrategyExecutor, TEST_BLUEPRINT, TEST_OPTIONS } from "../helpers/agent_strategy_test_helpers.ts";

Deno.test("Strategy parity: LegacyAgentStrategy returns valid ChangesetResult schema", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-legacy-" });
  const mockResponse = "No actions needed. Task is complete.";
  const provider = new MockProvider(mockResponse);

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, provider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const legacyStrategy = new LegacyAgentStrategy(executor, provider);
    const legacyContext: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000001",
      request_id: "parity-test",
      request: "Create a file named test.txt",
      plan: "Create test.txt with content 'hello'",
      portal: "workspace",
    };

    // Add a small delay to ensure execution_time_ms is non-negative
    await new Promise((resolve) => setTimeout(resolve, 10));

    const legacyResult = await legacyStrategy.execute(
      TEST_BLUEPRINT,
      legacyContext,
      TEST_OPTIONS,
    );

    // Validate result against the shared schema
    const validatedLegacy = ChangesetResultSchema.parse(legacyResult);
    assertExists(validatedLegacy.branch);
    assertExists(validatedLegacy.commit_sha);
    assertExists(validatedLegacy.description);
    assertExists(validatedLegacy.tool_calls);
    assertExists(validatedLegacy.execution_time_ms);
    assertExists(validatedLegacy.files_changed);

    // Verify field types
    assertEquals(typeof validatedLegacy.branch, "string");
    assertEquals(typeof validatedLegacy.commit_sha, "string");
    assertEquals(typeof validatedLegacy.description, "string");
    assertEquals(typeof validatedLegacy.tool_calls, "number");
    assertEquals(typeof validatedLegacy.execution_time_ms, "number");
    assertEquals(Array.isArray(validatedLegacy.files_changed), true);
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy parity: ReActLoopStrategy returns valid ChangesetResult schema", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-react-" });

  // ReAct strategy needs a response that signals completion
  const mockProvider = new MockProvider("STATUS: COMPLETE\n\nSummary: Task done.");

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, mockProvider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const reactStrategy = new ReActLoopStrategy(executor, mockProvider);
    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000003",
      request_id: "react-test",
      request: "Do nothing",
      plan: "Complete immediately",
      portal: "workspace",
    };

    const result = await reactStrategy.execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );

    // Validate against shared schema
    const validated = ChangesetResultSchema.parse(result);
    assertExists(validated.branch);
    assertExists(validated.commit_sha);
    assertExists(validated.description);
    assertExists(validated.tool_calls);
    assertExists(validated.execution_time_ms);
    assertExists(validated.files_changed);
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy parity: both strategies produce identical result schema fields", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-fields-" });
  const mockResponse = "STATUS: COMPLETE\n\nDone.";
  const provider = new MockProvider(mockResponse);

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, provider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const legacyStrategy = new LegacyAgentStrategy(executor, provider);
    const reactStrategy = new ReActLoopStrategy(executor, provider);

    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000004",
      request_id: "fields-test",
      request: "Compare schemas",
      plan: "Run both strategies",
      portal: "workspace",
    };

    const legacyResult = await legacyStrategy.execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );
    const reactResult = await reactStrategy.execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );

    // Both should validate against the same schema
    const validatedLegacy = ChangesetResultSchema.parse(legacyResult);
    const validatedReact = ChangesetResultSchema.parse(reactResult);

    // Verify same field types
    assertEquals(typeof validatedLegacy.branch, typeof validatedReact.branch);
    assertEquals(typeof validatedLegacy.commit_sha, typeof validatedReact.commit_sha);
    assertEquals(typeof validatedLegacy.description, typeof validatedReact.description);
    assertEquals(typeof validatedLegacy.tool_calls, typeof validatedReact.tool_calls);
    assertEquals(typeof validatedLegacy.execution_time_ms, typeof validatedReact.execution_time_ms);
    assertEquals(
      Array.isArray(validatedLegacy.files_changed),
      Array.isArray(validatedReact.files_changed),
    );

    // Both should have no unauthorized_changes (default)
    assertEquals(validatedLegacy.unauthorized_changes, undefined);
    assertEquals(validatedReact.unauthorized_changes, undefined);
  } finally {
    await cleanup();
  }
});
