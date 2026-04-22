/**
 * @module FlowNamespaceEndToEndTest
 * @path tests/integration/39_flow_namespace_end_to_end_test.ts
 * @description End-to-end coverage for namespace artifact persistence and same-wave write serialization.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/services/flow/flow_namespace_service.ts]
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "../../src/shared/constants.ts";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";
import { getMemoryExecutionDir } from "../helpers/paths_helper.ts";

Deno.test("[Step64.3] FlowRunner persists namespace artifact and preserves same-wave writes", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-namespace-e2e";
    const requestId = "req-flow-namespace-e2e";
    const flow: IFlowInput = {
      id: "namespace-e2e-flow",
      name: "Namespace E2E Flow",
      description: "Namespace artifact integration coverage",
      version: DEFAULT_FLOW_VERSION,
      namespace: {
        enabled: true,
        format: FlowOutputFormat.MARKDOWN,
        maxBytes: 4096,
      },
      steps: [
        {
          id: "alpha-step",
          name: "Alpha Step",
          identity: "agent1",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: { writes: [{ key: "alpha" }] },
        },
        {
          id: "beta-step",
          name: "Beta Step",
          identity: "agent2",
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: { writes: [{ key: "beta" }] },
        },
        {
          id: "reader-step",
          name: "Reader Step",
          identity: "agent3",
          dependsOn: ["alpha-step", "beta-step"],
          input: { source: FlowInputSource.AGGREGATE, from: ["alpha-step", "beta-step"], transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: {
            reads: [
              { key: "alpha", required: true },
              { key: "beta", required: true },
            ],
          },
        },
      ],
      output: { from: "reader-step", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 3, failFast: true },
    };

    const executor = new ScriptedAgentExecutor({
      agent1: ["alpha-value"],
      agent2: ["beta-value"],
      agent3: [(request) => JSON.stringify(request.sharedNamespace)],
    });
    const runner = new FlowRunner({
      agentExecutor: executor,
      eventLogger: new RecordingFlowLogger(),
      config,
    });

    const result = await runner.execute(flow as IFlow, {
      userPrompt: "produce namespace artifact",
      traceId,
      requestId,
    });

    const namespacePath = join(getMemoryExecutionDir(tempDir), traceId, "namespace.md");
    const readerRequest = executor.capturedRequests.find((entry) => entry.identityId === "agent3");
    assertExists(readerRequest);
    assertEquals(readerRequest.request.sharedNamespace, { alpha: "alpha-value", beta: "beta-value" });
    assertEquals(result.namespaceArtifactPath, namespacePath);
    assertEquals(await exists(namespacePath), true);
    const artifact = await Deno.readTextFile(namespacePath);
    assertStringIncludes(artifact, "## alpha");
    assertStringIncludes(artifact, "alpha-value");
    assertStringIncludes(artifact, "## beta");
    assertStringIncludes(artifact, "beta-value");
  } finally {
    await cleanup();
  }
});
