/**
 * @module PlanStepExecutionRegressionTest
 * @path tests/plan_step_execution_regression_test.ts
 * @description Regression tests for the core execution loop, ensuring reliable detection
 * and processing of structured plan steps while rejecting malformed content.
 */

import { assert, assertEquals } from "@std/assert";
import { parseStructuredPlanFromMarkdown } from "../../../src/services/plan/structured_plan_parser.ts";

Deno.test("[regression] ExecutionLoop detects structured plans with steps", () => {
  const traceId = crypto.randomUUID();
  const requestId = "test-structured-plan";

  const planContent = `---
trace_id: "${traceId}"
request_id: "${requestId}"
identity_id: "test-agent"
status: "approved"
created_at: "2026-01-26T10:00:00.000Z"
---

# Test Structured Plan

A plan with structured steps that should be executed.

## Execution Steps

## Step 1: Create test file

Create a test file to verify execution occurred.

## Step 2: Verify execution

Verify that the plan was actually executed.
`;

  const structuredPlan = parseStructuredPlanFromMarkdown(planContent, {
    trace_id: traceId,
    request_id: requestId,
    identity_id: "test-agent",
  });

  // Verify structured plan was detected
  assert(structuredPlan !== null, "Structured plan should be detected");
  assertEquals(structuredPlan!.trace_id, traceId, "Trace ID should match");
  assertEquals(structuredPlan!.request_id, requestId, "Request ID should match");
  assertEquals(structuredPlan!.steps.length, 2, "Should detect 2 steps");

  assertEquals(structuredPlan!.steps[0].number, 1, "First step should be number 1");
  assertEquals(structuredPlan!.steps[0].title, "Create test file", "First step title should match");
  assert(structuredPlan!.steps[0].content.includes("Create a test file"), "First step content should match");

  assertEquals(structuredPlan!.steps[1].number, 2, "Second step should be number 2");
  assertEquals(structuredPlan!.steps[1].title, "Verify execution", "Second step title should match");
});

Deno.test("[regression] ExecutionLoop rejects plans without executable content", () => {
  const traceId = crypto.randomUUID();
  const requestId = "test-no-actions";

  const planContent = `---
trace_id: "${traceId}"
request_id: "${requestId}"
identity_id: "test-agent"
status: "approved"
created_at: "2026-01-26T10:00:00.000Z"
---

# Test Plan Without Actions

This plan has no executable actions, but should not be marked complete without execution.

## Some Other Section

This is not an execution steps section.
`;

  const structuredPlan = parseStructuredPlanFromMarkdown(planContent, {
    trace_id: traceId,
    request_id: requestId,
    identity_id: "test-agent",
  });

  // Verify plan was NOT detected as structured (no "## Execution Steps" section)
  assertEquals(structuredPlan, null, "Plan without execution steps should not be detected as structured");
});
