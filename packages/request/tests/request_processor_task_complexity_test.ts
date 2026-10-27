/**
 * @module RequestProcessorTaskComplexityTest
 * @path packages/request/tests/request_processor_task_complexity_test.ts
 * @description Integration test verifying RequestProcessor.processAgentRequest stamps the
 *   IParsedRequest it hands to AgentRunner.run with the TaskComplexityClassifier's result
 *   (taskComplexity + taskComplexitySource), so AgentRunner's EffortResolver can resolve
 *   "auto" from the same complexity signal the provider selector used (GAP-2).
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts, packages/request/src/task_complexity_classifier.ts]
 */

import { assert, assertArrayIncludes } from "@std/assert";
import type { IAgentRunner, IBlueprint, IParsedRequest } from "@exaix/execution";
import { TaskComplexity } from "@exaix/core";
import { createStubProvider } from "@exaix/testing";
import { withProcessorWorkspace } from "./helpers/processor_workspace.ts";

const VALID_PLAN = JSON.stringify({
  subject: "Test",
  description: "A plan.",
  steps: [{ step: 1, title: "Step", description: "Do it." }],
});

function makeCapturingRunner() {
  let capturedRequest: IParsedRequest | undefined;
  const runner: IAgentRunner = {
    async run(blueprint: IBlueprint, request: IParsedRequest): Promise<never> {
      await Promise.resolve();
      capturedRequest = request;
      void blueprint;
      throw new Error("captured");
    },
  };
  return { runner, getCaptured: () => capturedRequest };
}

Deno.test("[RequestProcessor] the IParsedRequest passed to AgentRunner.run carries taskComplexity and taskComplexitySource", async () => {
  const provider = createStubProvider(
    `<thought>ok</thought><content>${VALID_PLAN}</content>`,
  );
  const { runner, getCaptured } = makeCapturingRunner();
  await withProcessorWorkspace(provider, async ({ requestPath, processor }) => {
    // The capturing runner deliberately throws after recording the request; process()
    // routes that through the rejected-plan handler and returns null. The capture is
    // what matters here.
    await processor.process(requestPath);

    const captured = getCaptured();
    assert(captured, "AgentRunner.run must have been called");
    assert(
      Object.values(TaskComplexity).includes(captured.taskComplexity as TaskComplexity),
      `taskComplexity must be a valid TaskComplexity, got ${captured.taskComplexity}`,
    );
    assertArrayIncludes(["analysis", "content_heuristic", "agent_role", "default"], [
      captured.taskComplexitySource ?? "",
    ], `taskComplexitySource must be one of the four sources, got ${captured.taskComplexitySource}`);
  }, runner);
});
