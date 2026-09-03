/**
 * @module FlowRunnerPortalThreadingTest
 * @path packages/flow/tests/flow_runner_portal_threading_test.ts
 * @description Phase 159 Step 3 (GAP-1 remediation): `FlowRunner.execute()`'s `request.portal`
 *   must reach the built `IFlowStepRequest` passed to `IAgentExecutor.run` — required so a
 *   strategy-routed step (Step 3's `runWithStrategy`) can resolve a portal alias. Proves the
 *   full chain (execute -> waves -> executeStep -> prepareStepRequest -> IFlowStepRequest)
 *   using a capturing IAgentExecutor, mirroring flow_runner_test.ts's MockAgentRunner.
 */

import { assertEquals } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { FlowRunner, type IAgentExecutor, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";

class CapturingAgentExecutor implements IAgentExecutor {
  capturedRequests: IFlowStepRequest[] = [];

  run(_identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.capturedRequests.push(request);
    return Promise.resolve({ thought: "ok", content: "done", raw: "done" });
  }
}

class NoOpEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

function makeFlow(): IFlow {
  return {
    id: "portal-threading-flow",
    name: "Portal Threading Flow",
    description: "test",
    version: "1.0.0",
    steps: [
      {
        id: "s1",
        name: "Step 1",
        type: FlowStepType.AGENT,
        agent_role: "senior-coder",
        execution_mode: FlowStepExecutionMode.DECLARED,
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ],
    output: { from: "s1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}

Deno.test("FlowRunner.execute: request.portal reaches the built IFlowStepRequest passed to IAgentExecutor.run", async () => {
  const agentExecutor = new CapturingAgentExecutor();
  const runner = new FlowRunner({ agentExecutor, eventLogger: new NoOpEventLogger() });

  await runner.execute(makeFlow(), {
    userPrompt: "do the thing",
    traceId: crypto.randomUUID(),
    requestId: "req-1",
    portal: "my-test-portal",
  });

  assertEquals(agentExecutor.capturedRequests.length, 1);
  assertEquals(agentExecutor.capturedRequests[0].portal, "my-test-portal");
});

Deno.test("FlowRunner.execute: no portal on the request leaves IFlowStepRequest.portal undefined", async () => {
  const agentExecutor = new CapturingAgentExecutor();
  const runner = new FlowRunner({ agentExecutor, eventLogger: new NoOpEventLogger() });

  await runner.execute(makeFlow(), {
    userPrompt: "do the thing",
    traceId: crypto.randomUUID(),
    requestId: "req-2",
  });

  assertEquals(agentExecutor.capturedRequests.length, 1);
  assertEquals(agentExecutor.capturedRequests[0].portal, undefined);
});
