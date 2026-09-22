/**
 * @module StepContentHasherTest
 * @path packages/flow/tests/step_content_hasher_test.ts
 * @description Unit tests for StepContentHasher — extracted from FlowRunner (god-object
 * decomposition). Verifies the hashing helpers are deterministic/content-sensitive and
 * computeSideEffectClass's classification matrix.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { StepContentHasher } from "@exaix/flow";
import {
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
  StepSideEffectClass,
  ToolName,
} from "@exaix/core";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";

const hasher = new StepContentHasher();

function makeFlow(overrides: Partial<IFlow> = {}): IFlow {
  return {
    id: "flow-1",
    name: "Flow One",
    steps: [],
    input: { source: FlowInputSource.REQUEST },
    output: { format: FlowOutputFormat.MARKDOWN },
    ...overrides,
  } as IFlow;
}

function makeStep(overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id: "step-1",
    name: "Step One",
    type: FlowStepType.AGENT,
    ...overrides,
  } as IFlowStep;
}

Deno.test("[StepContentHasher] computeFlowContentHash is deterministic and content-sensitive", async () => {
  const a = await hasher.computeFlowContentHash(makeFlow());
  const b = await hasher.computeFlowContentHash(makeFlow());
  const c = await hasher.computeFlowContentHash(makeFlow({ name: "Flow Two" }));
  assertEquals(a, b);
  assertNotEquals(a, c);
});

Deno.test("[StepContentHasher] computeStepInputHash hashes only userPrompt/context/skills", async () => {
  const base = { userPrompt: "do the thing", context: { a: 1 }, skills: ["s1"] };
  const a = await hasher.computeStepInputHash(base);
  const b = await hasher.computeStepInputHash({ ...base, traceId: "different-trace-id" });
  const c = await hasher.computeStepInputHash({ ...base, userPrompt: "do another thing" });
  assertEquals(a, b, "fields outside userPrompt/context/skills must not affect the hash");
  assertNotEquals(a, c);
});

Deno.test("[StepContentHasher] computeStringHash is deterministic and content-sensitive", async () => {
  const a = await hasher.computeStringHash("hello");
  const b = await hasher.computeStringHash("hello");
  const c = await hasher.computeStringHash("world");
  assertEquals(a, b);
  assertNotEquals(a, c);
});

Deno.test("[StepContentHasher] computeSideEffectClass classifies gate/tool/git/llm/mixed steps", () => {
  assertEquals(hasher.computeSideEffectClass(makeStep({ type: FlowStepType.GATE })), StepSideEffectClass.NONE);

  assertEquals(
    hasher.computeSideEffectClass(
      makeStep({ execution_mode: FlowStepExecutionMode.DYNAMIC, permitted_tools: [ToolName.READ_FILE] }),
    ),
    StepSideEffectClass.TOOL,
  );

  assertEquals(
    hasher.computeSideEffectClass(
      makeStep({ execution_mode: FlowStepExecutionMode.DYNAMIC, permitted_tools: [ToolName.GIT_COMMIT] }),
    ),
    StepSideEffectClass.GIT,
  );

  assertEquals(
    hasher.computeSideEffectClass(makeStep({ execution_mode: FlowStepExecutionMode.DECLARED, permitted_tools: [] })),
    StepSideEffectClass.LLM,
  );

  assertEquals(
    hasher.computeSideEffectClass(
      makeStep({ execution_mode: FlowStepExecutionMode.DECLARED, permitted_tools: [ToolName.READ_FILE] }),
    ),
    StepSideEffectClass.MIXED,
  );
});
