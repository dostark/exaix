/**
 * @module FlowRunnerNamespaceNoRegressionTest
 * @path tests/flows/flow_runner_namespace_no_regression_test.ts
 * @description Guards unchanged FlowRunner behavior when namespace support is not configured.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "@exaix/core";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";

Deno.test("[Step64.3] FlowRunner preserves behavior when namespace is disabled", async () => {
  const flow: IFlowInput = {
    id: "namespace-regression-flow",
    name: "Namespace Regression Flow",
    description: "Namespace should not affect flows without namespace config",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      {
        id: "step2",
        name: "Step 2",
        identity: "agent2",
        dependsOn: ["step1"],
        input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
    ],
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 2, failFast: true },
  };

  const executor = new ScriptedAgentExecutor({
    agent1: ["unchanged-step-one"],
    agent2: ["unchanged-step-two"],
  });
  const logger = new RecordingFlowLogger();
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: logger });

  const result = await runner.execute(flow as IFlow, { userPrompt: "no namespace here" });

  assertEquals(result.success, true);
  assertEquals(result.output, "unchanged-step-two");
  assertEquals(result.namespaceArtifactPath, undefined);
  assertEquals(
    executor.capturedRequests.every((entry) => entry.request.sharedNamespace === undefined),
    true,
  );
  assertEquals(logger.events.some((entry) => entry.event.startsWith("flow.namespace.")), false);
});
