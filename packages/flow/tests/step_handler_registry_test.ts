/**
 * @module StepHandlerRegistryTest
 * @path packages/flow/tests/step_handler_registry_test.ts
 * @description Unit tests for IFlowStepHandler, IFlowStepHandlerRegistry, FlowStepHandlerRegistry,
 * and UnknownFlowStepError (Phase 115 Step 3a).
 */

import { assert, assertEquals } from "@std/assert";
import { FlowStepType } from "@exaix/core";
import {
  FlowStepHandlerRegistry,
  type IFlowStepHandler,
  type IFlowStepHandlerRegistry,
  type IStepExecutionContext,
  UnknownFlowStepError,
} from "@exaix/flow";

// ============================================================
// Test doubles
// ============================================================

class StubHandler implements IFlowStepHandler {
  readonly stepType: string;
  executed = false;
  lastCtx?: IStepExecutionContext;

  constructor(stepType: string) {
    this.stepType = stepType;
  }

  execute(ctx: IStepExecutionContext): Promise<{ thought: string; content: string; raw: string }> {
    this.executed = true;
    this.lastCtx = ctx;
    return Promise.resolve({ thought: "stub", content: "stub-output", raw: "{}" });
  }
}

// ============================================================
// IFlowStepHandlerRegistry contract
// ============================================================

Deno.test("[flow] FlowStepHandlerRegistry — register and get a handler", () => {
  const registry: IFlowStepHandlerRegistry = new FlowStepHandlerRegistry();
  const handler = new StubHandler(FlowStepType.GATE);

  registry.register(handler);
  const retrieved = registry.get(FlowStepType.GATE);

  assertEquals(retrieved, handler);
  assertEquals(retrieved?.stepType, FlowStepType.GATE);
});

Deno.test("[flow] FlowStepHandlerRegistry — has returns true for registered type", () => {
  const registry = new FlowStepHandlerRegistry();
  registry.register(new StubHandler(FlowStepType.AGENT));

  assertEquals(registry.has(FlowStepType.AGENT), true);
  assertEquals(registry.has(FlowStepType.GATE), false);
});

Deno.test("[flow] FlowStepHandlerRegistry — get on unknown type returns undefined", () => {
  const registry = new FlowStepHandlerRegistry();
  const result = registry.get("non-existent-type");

  assertEquals(result, undefined);
});

Deno.test("[flow] FlowStepHandlerRegistry — get with string key works", () => {
  const registry = new FlowStepHandlerRegistry();
  const handler = new StubHandler("custom-type");
  registry.register(handler);

  assertEquals(registry.get("custom-type"), handler);
});

Deno.test("[flow] FlowStepHandlerRegistry — register overwrites existing handler for same key", () => {
  const registry = new FlowStepHandlerRegistry();
  const first = new StubHandler("dup");
  const second = new StubHandler("dup");

  registry.register(first);
  registry.register(second);

  assertEquals(registry.get("dup"), second);
});

function makeMinimalCtx(stepType: string): IStepExecutionContext {
  return {
    stepType,
    step: { id: "step-1", type: stepType } as IStepExecutionContext["step"],
    flow: { id: "flow-1" },
    request: { userPrompt: "test" },
    stepRequest: { userPrompt: "test", context: {} },
    flowRunId: "run-1",
    startedAt: new Date(),
    flowLogBase: { flowId: "flow-1" },
  } as IStepExecutionContext;
}

Deno.test("[flow] StubHandler.execute produces expected result", async () => {
  const handler = new StubHandler(FlowStepType.AGENT);
  const ctx = makeMinimalCtx(FlowStepType.AGENT);

  const result = await handler.execute(ctx);

  assertEquals(result.thought, "stub");
  assertEquals(result.content, "stub-output");
  assertEquals(handler.executed, true);
  assertEquals(handler.lastCtx, ctx);
});

// ============================================================
// UnknownFlowStepError
// ============================================================

Deno.test("[flow] UnknownFlowStepError — message includes step type and id", () => {
  const error = new UnknownFlowStepError("voting_group", "step-42");

  assertEquals(error.name, "UnknownFlowStepError");
  assertEquals(error.stepType, "voting_group");
  assertEquals(error.stepId, "step-42");
  assert(error.message.includes("voting_group"));
  assert(error.message.includes("step-42"));
});

Deno.test("[flow] UnknownFlowStepError — extends FlowExecutionError", () => {
  const error = new UnknownFlowStepError("bad-type", "step-99");
  // FlowExecutionError has name "FlowExecutionError", but UnknownFlowStepError overrides it
  assertEquals(error.name, "UnknownFlowStepError");
  // instanceof should still work through the prototype chain
  assertEquals(error instanceof Error, true);
});

Deno.test("[flow] UnknownFlowStepError — defaults stepId to empty string", () => {
  const error = new UnknownFlowStepError("bad-type");

  assertEquals(error.stepId, "");
  assertEquals(error.stepType, "bad-type");
});
