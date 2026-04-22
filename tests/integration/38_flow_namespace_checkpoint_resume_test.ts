/**
 * @module FlowNamespaceCheckpointResumeTest
 * @path tests/integration/38_flow_namespace_checkpoint_resume_test.ts
 * @description Verifies namespace persistence across checkpoint resume and guards failed-step non-writes.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/services/flow/flow_checkpoint_service.ts, src/services/flow/flow_namespace_service.ts]
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import { FlowExecutionError, FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_NAMESPACE_READ,
} from "../../src/shared/constants.ts";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";
import { getMemoryExecutionDir } from "../helpers/paths_helper.ts";

Deno.test("[Step64.3] FlowRunner resumes with persisted namespace state and skips failed-step writes", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-namespace-resume";
    const requestId = "req-flow-namespace-resume";
    const namespacePath = join(getMemoryExecutionDir(tempDir), traceId, "namespace.md");
    const flow: IFlowInput = {
      id: "namespace-resume-flow",
      name: "Namespace Resume Flow",
      description: "Resume coverage for flow namespace",
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
          namespace: { writes: [{ key: "summary" }] },
        },
        {
          id: "reader",
          name: "Reader",
          identity: "agent2",
          dependsOn: ["writer"],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          namespace: {
            reads: [{ key: "summary", required: true }],
            writes: [{ key: "should.not.persist" }],
          },
        },
      ],
      output: { from: "reader", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 2, failFast: true },
    };

    const firstRunExecutor = new ScriptedAgentExecutor({
      agent1: ["persisted-summary"],
      agent2: [new Error("reader failed")],
    });
    const firstRunRunner = new FlowRunner({
      agentExecutor: firstRunExecutor,
      eventLogger: new RecordingFlowLogger(),
      config,
    });

    await assertRejects(
      () => firstRunRunner.execute(flow as IFlow, { userPrompt: "resume namespace", traceId, requestId }),
      FlowExecutionError,
    );

    assertEquals(await exists(namespacePath), true);
    const failedRunArtifact = await Deno.readTextFile(namespacePath);
    assertStringIncludes(failedRunArtifact, "persisted-summary");
    assertEquals(failedRunArtifact.includes("should.not.persist"), false);

    const resumedExecutor = new ScriptedAgentExecutor({
      agent1: [new Error("writer should not rerun")],
      agent2: [(request) => `reader:${request.sharedNamespace?.summary ?? "missing"}`],
    });
    const resumedLogger = new RecordingFlowLogger();
    const resumedRunner = new FlowRunner({
      agentExecutor: resumedExecutor,
      eventLogger: resumedLogger,
      config,
    });

    const resumedResult = await resumedRunner.execute(flow as IFlow, {
      userPrompt: "resume namespace",
      traceId,
      requestId,
    });

    const readerRequest = resumedExecutor.capturedRequests.find((entry) => entry.identityId === "agent2");
    assertExists(readerRequest);
    assertEquals(readerRequest.request.sharedNamespace, { summary: "persisted-summary" });
    assertEquals(resumedResult.success, true);
    assertEquals(resumedResult.output, "reader:persisted-summary");
    assertEquals(resumedExecutor.calls.includes("agent1"), false);
    assertEquals(resumedResult.namespaceArtifactPath, namespacePath);
    assertEquals(resumedLogger.events.some((entry) => entry.event === FLOW_EVENT_NAMESPACE_READ), true);
  } finally {
    await cleanup();
  }
});
