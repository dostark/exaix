// deno-lint-ignore-file no-explicit-any
/**
 * @module DefineFlowUnitTest
 * @path packages/flow/tests/define_flow_unit_test.ts
 * @description Unit tests for defineFlow utility.
 */

import { assertEquals } from "@std/assert";
import { defineFlow } from "@exaix/core/func";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";

function cast<T>(obj: any): T {
  return obj as T;
}

type IDefineFlowInput = Parameters<typeof defineFlow>[0];

Deno.test("defineFlow: validation of required fields", () => {
  let thrown = false;
  try {
    defineFlow(cast<IDefineFlowInput>({ id: "", name: "n", description: "d", steps: [], output: { from: "s" } }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Flow ID cannot be empty");
  }
  assertEquals(thrown, true);

  thrown = false;
  try {
    defineFlow(cast<IDefineFlowInput>({ id: "id", name: "", description: "d", steps: [], output: { from: "s" } }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Flow name cannot be empty");
  }
  assertEquals(thrown, true);

  thrown = false;
  try {
    defineFlow(cast<IDefineFlowInput>({ id: "id", name: "n", description: "", steps: [], output: { from: "s" } }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Flow description cannot be empty");
  }
  assertEquals(thrown, true);

  thrown = false;
  try {
    defineFlow(cast({ id: "id", name: "n", description: "d", steps: [], output: { from: "s" } }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Flow must have at least one step");
  }
  assertEquals(thrown, true);
});

Deno.test("defineFlow: validates step IDs and names", () => {
  let thrown = false;
  try {
    defineFlow(cast({
      id: "f",
      name: "n",
      description: "d",
      steps: [{}],
      output: { from: "s" },
    }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Step ID cannot be empty");
  }
  assertEquals(thrown, true);

  thrown = false;
  try {
    defineFlow(cast({
      id: "f",
      name: "n",
      description: "d",
      steps: [{ id: "s1" }],
      output: { from: "s" },
    }));
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Step name cannot be empty");
  }
  assertEquals(thrown, true);
});

Deno.test("defineFlow: applies sensible defaults", () => {
  const flow = defineFlow({
    id: "test-flow",
    name: "Test IFlow as Flow",
    description: "A test flow",
    steps: [{
      id: "step1",
      name: "Step 1",
      agent_role: "agent-1",
    }],
    output: { from: "step1" },
  });

  assertEquals(flow.version, "1.0.0");
  assertEquals(flow.steps[0].dependsOn, []);
  assertEquals(flow.steps[0].input.source, FlowInputSource.REQUEST);
  assertEquals(flow.steps[0].input.transform, "passthrough");
  assertEquals(flow.steps[0].retry.maxAttempts, 1);
  assertEquals(flow.steps[0].retry.backoffMs, 1000);
  assertEquals(flow.output.format, FlowOutputFormat.MARKDOWN);
  assertEquals(flow.settings.maxParallelism, 3);
  assertEquals(flow.settings.failFast, true);
});

Deno.test("defineFlow: accepts custom configurations", () => {
  const flow = defineFlow({
    id: "custom-flow",
    name: "Custom IFlow as Flow",
    description: "Custom flow",
    version: "2.5.0",
    steps: [{
      id: "s1",
      name: "S1",
      agent_role: "ag1",
      dependsOn: ["other"],
      input: {
        source: FlowInputSource.STEP,
        stepId: "other",
        transform: "custom",
      },
      retry: {
        maxAttempts: 5,
        backoffMs: 2000,
      },
      condition: "true",
      timeout: 5000,
    }],
    output: { from: "s1", format: FlowOutputFormat.JSON },
    settings: {
      maxParallelism: 10,
      failFast: false,
      timeout: 60000,
    },
  });

  assertEquals(flow.version, "2.5.0");
  assertEquals(flow.steps[0].dependsOn, ["other"]);
  assertEquals(flow.steps[0].input.source, FlowInputSource.STEP);
  assertEquals(flow.steps[0].input.stepId, "other");
  assertEquals(flow.steps[0].retry.maxAttempts, 5);
  assertEquals(flow.steps[0].condition, "true");
  assertEquals(flow.steps[0].timeout, 5000);
  assertEquals(flow.output.format, FlowOutputFormat.JSON);
  assertEquals(flow.settings.maxParallelism, 10);
  assertEquals(flow.settings.failFast, false);
  assertEquals(flow.settings.timeout, 60000);
});

Deno.test("defineFlow: rejects step config without identity field (Phase 54)", () => {
  // TypeScript should not accept step without identity field
  // This test verifies the type system requires identity field
  let thrown = false;
  try {
    // Using cast to bypass TypeScript check - runtime should still work
    // but the type system should require identity field
    defineFlow(cast({
      id: "test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "s1",
        name: "S1",
        // missing identity field - should fail
      }],
      output: { from: "s1" },
    }));
    // If we reach here, missing identity was accepted (should not happen)
    thrown = false;
  } catch (err) {
    // Expected: FlowSchema validation should reject steps without identity
    thrown = true;
    assertEquals((err as Error).message.includes("identity"), true);
  }
  assertEquals(thrown, true);
});

Deno.test("defineFlow: requires 'agent_role' field in step config (Phase 54)", () => {
  // Verify that identity field is required and works correctly
  let thrown = false;
  try {
    defineFlow(cast({
      id: "test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "s1",
        name: "S1",
        // missing identity field
      }],
      output: { from: "s1" },
    }));
  } catch (err) {
    thrown = true;
    // Should fail validation due to missing identity
    assertEquals((err as Error).message.includes("identity"), true);
  }
  assertEquals(thrown, true);
});
