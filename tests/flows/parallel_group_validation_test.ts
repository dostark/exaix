/**
 * @module ParallelGroupValidationTest
 * @path tests/flows/parallel_group_validation_test.ts
 * @description Verifies Phase 65 cross-step parallel group validation in FlowRunner.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/shared/schemas/flow.ts]
 */

import { assertRejects, assertStringIncludes } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import {
  FlowExecutionError,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../src/services/agent/agent_runner.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "../../src/shared/constants.ts";
import type { JSONValue } from "../../src/shared/types/json.ts";

class StubAgentExecutor implements IAgentExecutor {
  async run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return await Promise.resolve({ thought: "", content: "ok", raw: "ok" });
  }
}

class SilentEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

function createRunner(): FlowRunner {
  return new FlowRunner({
    agentExecutor: new StubAgentExecutor(),
    eventLogger: new SilentEventLogger(),
  });
}

Deno.test("FlowRunner: rejects mergeFromGroups reference to unknown parallel group", async () => {
  const runner = createRunner();
  const flow: IFlowInput = {
    id: "invalid-merge-ref",
    name: "Invalid Merge Ref",
    description: "Unknown parallel group reference should fail validation",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "review-a",
        name: "Review A",
        identity: "qa-engineer",
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "reviewers" },
      },
      {
        id: "merge",
        name: "Merge",
        identity: "senior-coder",
        dependsOn: ["review-a"],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["missing-group"],
        mergeMode: "all",
      },
    ],
    output: {
      from: ["merge"],
      format: FlowOutputFormat.MARKDOWN,
    },
  };

  const error = await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "parallel validate", requestId: "req-65-1-a" }),
    FlowExecutionError,
  );

  assertStringIncludes(error.message, "missing-group");
});

Deno.test("FlowRunner: rejects unknown step IDs in parallel.order", async () => {
  const runner = createRunner();
  const flow: IFlowInput = {
    id: "invalid-order-ref",
    name: "Invalid Order Ref",
    description: "Unknown step IDs in group order should fail validation",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "review-a",
        name: "Review A",
        identity: "qa-engineer",
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: {
          group: "reviewers",
          mergeMode: "ordered",
          order: ["review-a", "ghost-step"],
        },
      },
      {
        id: "review-b",
        name: "Review B",
        identity: "security-expert",
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: {
          group: "reviewers",
          mergeMode: "ordered",
          order: ["review-a", "ghost-step"],
        },
      },
    ],
    output: {
      from: ["review-a", "review-b"],
      format: FlowOutputFormat.MARKDOWN,
    },
  };

  const error = await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "parallel validate", requestId: "req-65-1-b" }),
    FlowExecutionError,
  );

  assertStringIncludes(error.message, "ghost-step");
  assertStringIncludes(error.message, "reviewers");
});
