/**
 * @module FlowStepSchemaStrategyTest
 * @path packages/schemas/tests/flow_step_strategy_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies FlowStepSchema supports the optional `strategy` field (Phase 159 Step 1):
 * a DECLARED agent step may force `react`/`mcp`/`cli_delegate`; a DYNAMIC or non-agent step may not.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { ExecutionStrategyName, FlowStepExecutionMode, FlowStepType } from "@exaix/core";

/**
 * Tests for Phase 159 Step 1: FlowStepSchema `strategy` field
 *
 * Success Criteria:
 * - The schema accepts only react | mcp | cli_delegate on DECLARED agent steps
 * - A DYNAMIC or non-agent step declaring `strategy` fails schema validation
 * - Existing flow schema tests remain green (no behavioural change without `strategy`)
 */

Deno.test("FlowStepSchema: accepts strategy: react on a DECLARED agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
    strategy: ExecutionStrategyName.REACT,
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.strategy, ExecutionStrategyName.REACT);
});

Deno.test("FlowStepSchema: accepts strategy: mcp on a DECLARED agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    strategy: ExecutionStrategyName.MCP,
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.strategy, ExecutionStrategyName.MCP);
});

Deno.test("FlowStepSchema: accepts strategy: cli_delegate on a DECLARED agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    strategy: ExecutionStrategyName.CLI_DELEGATE,
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.strategy, ExecutionStrategyName.CLI_DELEGATE);
});

Deno.test("FlowStepSchema: strategy is undefined when not specified (no behaviour change)", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.strategy, undefined);
});

Deno.test("FlowStepSchema: rejects an invalid strategy value", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    strategy: "legacy",
  };

  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: rejects strategy on a DYNAMIC step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    strategy: ExecutionStrategyName.REACT,
  };

  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: rejects strategy on a non-agent step type", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    identity: "senior-coder",
    type: FlowStepType.GATE,
    strategy: ExecutionStrategyName.REACT,
  };

  assertThrows(() => FlowStepSchema.parse(step));
});
