/**
 * @module AgentStrategyResultTest
 * @path tests/regression/strategy_parity_test.ts
 * @description Verifies the unified ReAct execution strategy returns a usable schema result.
 * @architectural-layer Integration
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/schemas/src/agent_composer.ts]
 */

import { assert } from "@std/assert";
import { ChangesetResultSchema } from "@exaix/schemas/agent_composer.ts";
import { ReActLoopStrategy } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { setupStrategyExecutor, TEST_BLUEPRINT, TEST_OPTIONS } from "../helpers/agent_strategy_test_helpers.ts";

Deno.test("ReActLoopStrategy returns a schema-valid, usable ChangesetResult", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-result-react-" });
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
    const result: IChangesetResult = await new ReActLoopStrategy(executor, provider).execute(
      TEST_BLUEPRINT,
      context,
      TEST_OPTIONS,
    );
    const validated = ChangesetResultSchema.parse(result);
    assert(validated.branch.length > 0);
    assert(validated.description.length > 0);
    assert(validated.files_changed.every((file) => file.length > 0));
  } finally {
    await cleanup();
  }
});
