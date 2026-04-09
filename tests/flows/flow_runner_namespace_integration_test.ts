/**
 * @module FlowRunnerNamespaceIntegrationTest
 * @path tests/flows/flow_runner_namespace_integration_test.ts
 * @description Covers FlowRunner namespace hydration, event emission, and artifact path reporting.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/services/flow/flow_namespace_service.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "../../src/shared/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "../../src/shared/constants.ts";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";
import { getMemoryExecutionDir } from "../helpers/paths_helper.ts";
import { join } from "@std/path";

Deno.test("[Step64.3] FlowRunner hydrates sharedNamespace and reports namespace artifact path", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-namespace-integration";
    const requestId = "req-flow-namespace-integration";
    const flow: IFlowInput = {
      id: "namespace-integration-flow",
      name: "Namespace Integration Flow",
      description: "Flow namespace integration coverage",
      version: DEFAULT_FLOW_VERSION,
      namespace: {
        enabled: true,
        format: FlowOutputFormat.MARKDOWN,
        maxBytes: 4096,
      },
      steps: [
        {
          id: "writer",
          name: "Writer",
          identity: "agent1",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: {
            writes: [{ key: "analysis.summary" }],
          },
        },
        {
          id: "reader",
          name: "Reader",
          identity: "agent2",
          dependsOn: ["writer"],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: {
            reads: [{ key: "analysis.summary", required: true }],
          },
        },
      ],
      output: { from: "reader", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 2, failFast: true },
    };

    const executor = new ScriptedAgentExecutor({
      agent1: ["shared finding"],
      agent2: [(request) => `reader:${request.sharedNamespace?.["analysis.summary"] ?? "missing"}`],
    });
    const logger = new RecordingFlowLogger();
    const runner = new FlowRunner({ agentExecutor: executor, eventLogger: logger, config });

    const result = await runner.execute(flow as IFlow, {
      userPrompt: "review this flow",
      traceId,
      requestId,
    });

    const readerRequest = executor.capturedRequests.find((entry) => entry.identityId === "agent2");
    assertExists(readerRequest);
    assertEquals(readerRequest.request.sharedNamespace, { "analysis.summary": "shared finding" });
    assertEquals(result.output, "reader:shared finding");
    assertEquals(
      result.namespaceArtifactPath,
      join(getMemoryExecutionDir(tempDir), traceId, "namespace.md"),
    );
    assertEquals(logger.events.some((entry) => entry.event === "flow.namespace.initialized"), true);
    assertEquals(logger.events.some((entry) => entry.event === "flow.namespace.read"), true);
    assertEquals(logger.events.some((entry) => entry.event === "flow.namespace.write"), true);
  } finally {
    await cleanup();
  }
});
