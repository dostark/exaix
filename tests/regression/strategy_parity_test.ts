/**
 * @module StrategyParityTest
 * @path tests/regression/strategy_parity_test.ts
 * @description Verifies that every IExecutionStrategy implementation produces a result the shared
 *   `ChangesetResultSchema` accepts, and that the two strategies agree on the SHAPE of what they
 *   return. Step 61.5 strategy unification parity.
 *
 *   Previously this file re-asserted, after `ChangesetResultSchema.parse()` had already returned,
 *   that `typeof validated.branch === "string"` and `Array.isArray(validated.files_changed)`. Those
 *   fields are required and non-optional in the schema, so the parse is what enforces them — every
 *   check after it was true by construction. The parity test was the worst case: it compared
 *   `typeof legacy.branch` to `typeof react.branch`, i.e. `"string"` to `"string"`, both fixed by
 *   the same parse two lines above. It could not fail for any input.
 *
 *   The parse call IS the schema assertion and is kept. What is added is what the schema does NOT
 *   guarantee: non-empty identifiers, and key-set agreement between the strategies — an optional
 *   field set by one strategy and omitted by the other is a real divergence and now fails here.
 *
 *   NOT covered: the previous header also claimed these strategies "emit identical event types to
 *   the Activity Journal". Nothing in this file ever read the journal, and the strategies emit no
 *   distinct events of their own (`AgentOrchestrator` emits `AgentOutput` for both), so there is no
 *   divergence to assert today. The claim is dropped rather than backed by a comparison of two
 *   empty sets.
 * @architectural-layer Test
 * @related-files [packages/schemas/src/agent_orchestrator.ts, packages/execution/src/strategies/]
 */

import { assert, assertEquals } from "@std/assert";
import { ChangesetResultSchema } from "@exaix/schemas/agent_orchestrator.ts";
import { LegacyAgentStrategy } from "@exaix/execution";
import { ReActLoopStrategy } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import { setupStrategyExecutor, TEST_BLUEPRINT, TEST_OPTIONS } from "../helpers/agent_strategy_test_helpers.ts";

/** Assertions the schema cannot make: `z.string()` accepts "", so a blank branch or description parses cleanly while being useless downstream. */
function assertSemanticallyUsable(result: IChangesetResult, strategy: string): void {
  assert(result.branch.length > 0, `${strategy}: branch must not be blank`);
  assert(result.description.length > 0, `${strategy}: description must not be blank`);
  for (const file of result.files_changed) {
    assert(file.length > 0, `${strategy}: files_changed must not contain blank entries`);
  }
}

Deno.test("Strategy parity: LegacyAgentStrategy returns a schema-valid, usable ChangesetResult", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-legacy-" });
  const provider = new MockProvider("No actions needed. Task is complete.");

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, provider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000001",
      request_id: "parity-test",
      request: "Create a file named test.txt",
      plan: "Create test.txt with content 'hello'",
      portal: "workspace",
    };

    // Non-negative execution_time_ms is a schema constraint; give the clock something to measure.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await new LegacyAgentStrategy(executor, provider).execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );

    // parse() throws on any missing or mistyped required field — this is the schema assertion.
    assertSemanticallyUsable(ChangesetResultSchema.parse(result), "legacy");
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy parity: ReActLoopStrategy returns a schema-valid, usable ChangesetResult", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-react-" });
  const provider = new MockProvider("STATUS: COMPLETE\n\nSummary: Task done.");

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, provider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000003",
      request_id: "react-test",
      request: "Do nothing",
      plan: "Complete immediately",
      portal: "workspace",
    };

    const result = await new ReActLoopStrategy(executor, provider).execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );

    assertSemanticallyUsable(ChangesetResultSchema.parse(result), "react");
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy parity: both strategies return the same field set", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-parity-fields-" });
  const provider = new MockProvider("STATUS: COMPLETE\n\nDone.");

  const { executor, cleanup } = await setupStrategyExecutor(tempDir, provider, {
    group: "regression",
    file: "strategy_parity_test",
  });

  try {
    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000004",
      request_id: "fields-test",
      request: "Compare schemas",
      plan: "Run both strategies",
      portal: "workspace",
    };

    const legacy = ChangesetResultSchema.parse(
      await new LegacyAgentStrategy(executor, provider).execute(TEST_BLUEPRINT, context, TEST_OPTIONS),
    );
    const react = ChangesetResultSchema.parse(
      await new ReActLoopStrategy(executor, provider).execute(TEST_BLUEPRINT, context, TEST_OPTIONS),
    );

    // The real parity risk: the schema's OPTIONAL fields. One strategy populating `usage` or
    // `unauthorized_changes` while the other omits it is a divergence every consumer that reads
    // both would hit, and it is invisible to a per-strategy schema check.
    assertEquals(
      Object.keys(legacy).sort(),
      Object.keys(react).sort(),
      "strategies disagree on which optional fields they populate",
    );

    // Sandboxed execution routes every write through MCP tools, so neither strategy may report
    // out-of-band modifications.
    assertEquals(legacy.unauthorized_changes, undefined);
    assertEquals(react.unauthorized_changes, undefined);
  } finally {
    await cleanup();
  }
});
