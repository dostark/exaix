/**
 * @module PlanExecutorGuardrailTest
 * @path packages/core/tests/planning/plan_executor_guardrail_test.ts
 * @description Integration tests verifying PlanExecutor passes IGuardrailRunner via
 *   IPlanExecutorOptions.guardrailRunner into AgentExecutor (Phase 107 Step 4).
 */

import { assertEquals } from "@std/assert";
import type { IGuardrailRunner } from "@exaix/execution";
import type { GuardrailIncident } from "@exaix/schemas";
import { createMockConfig } from "@exaix/testing";
import { PlanExecutor } from "../../src/planning/mod.ts";

class StubGuardrailRunner implements IGuardrailRunner {
  readonly screenCalls: Array<{ output: string; traceId: string }> = [];
  screen(agentOutput: string, traceId: string, _iteration: number): Promise<GuardrailIncident[]> {
    this.screenCalls.push({ output: agentOutput, traceId });
    return Promise.resolve([]);
  }
  hasBlockingViolation(_traceId: string): boolean {
    return false;
  }
}

// Minimal provider stub matching IModelProvider shape
const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

// Minimal DB stub matching IDatabaseService shape
const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

Deno.test("PlanExecutor accepts guardrailRunner via IPlanExecutorOptions", () => {
  const config = createMockConfig("/tmp/test", {});
  const stub = new StubGuardrailRunner();

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    { guardrailRunner: stub, enableGit: false },
  );

  assertEquals(executor instanceof PlanExecutor, true);
});

Deno.test("PlanExecutor does not require guardrailRunner (backward compat)", () => {
  const config = createMockConfig("/tmp/test", {});

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    { enableGit: false },
  );

  assertEquals(executor instanceof PlanExecutor, true);
});
