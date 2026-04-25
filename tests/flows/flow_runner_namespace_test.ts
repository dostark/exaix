/**
 * @module FlowRunnerNamespaceTest
 * @path tests/flows/flow_runner_namespace_test.ts
 * @description Verifies namespace event payload fields emitted by FlowRunner.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/services/flow/flow_namespace_service.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_NAMESPACE_INITIALIZED,
  FLOW_EVENT_NAMESPACE_WRITE,
} from "@exaix/core";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";

function createNamespaceFlow(): IFlowInput {
  return {
    id: "namespace-payload-flow",
    name: "Namespace Payload Flow",
    description: "Verifies namespace event payload fields",
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
        namespace: { writes: [{ key: "analysis.summary" }] },
      },
    ],
    output: { from: "writer", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true },
  };
}

Deno.test("[Step64.7] flow.namespace.initialized event carries namespaceId and flowId", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const logger = new RecordingFlowLogger();
    const runner = new FlowRunner({
      agentExecutor: new ScriptedAgentExecutor({ agent1: ["shared finding"] }),
      eventLogger: logger,
      config,
    });

    await runner.execute(createNamespaceFlow() as IFlow, {
      userPrompt: "verify initialized payload",
      traceId: "trace-namespace-payload-init",
      requestId: "req-namespace-payload-init",
    });

    const initializedEvent = logger.events.find((entry) => entry.event === FLOW_EVENT_NAMESPACE_INITIALIZED);
    assertExists(initializedEvent);
    assertEquals(typeof initializedEvent.payload.namespaceId, "string");
    assertEquals((initializedEvent.payload.namespaceId as string).length > 0, true);
    assertEquals(initializedEvent.payload.flowId, "namespace-payload-flow");
  } finally {
    await cleanup();
  }
});

Deno.test("[Step64.7] flow.namespace.write event carries namespaceId and stepId", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const logger = new RecordingFlowLogger();
    const runner = new FlowRunner({
      agentExecutor: new ScriptedAgentExecutor({ agent1: ["shared finding"] }),
      eventLogger: logger,
      config,
    });

    await runner.execute(createNamespaceFlow() as IFlow, {
      userPrompt: "verify write payload",
      traceId: "trace-namespace-payload-write",
      requestId: "req-namespace-payload-write",
    });

    const writeEvent = logger.events.find((entry) => entry.event === FLOW_EVENT_NAMESPACE_WRITE);
    assertExists(writeEvent);
    assertEquals(typeof writeEvent.payload.namespaceId, "string");
    assertEquals((writeEvent.payload.namespaceId as string).length > 0, true);
    assertEquals(writeEvent.payload.stepId, "writer");
  } finally {
    await cleanup();
  }
});
