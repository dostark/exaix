/**
 * @module Phase147FlowNamespaceCutoverTest
 * @path packages/flow/tests/phase147_flow_namespace_cutover_test.ts
 * @description [integration] Phase 147 Step 12 cutover: a real flow run with
 *   `namespace.enabled: true` declaring a from-path write, an append-mode write, and a
 *   required from-path read — driven through FlowNamespaceCoordinator onto the unified
 *   ExecutionMemoryStore. Asserts FLOW_EVENT_NAMESPACE_INITIALIZED/_READ/_WRITE fire
 *   unchanged, the flow completes, and namespace.md is never created.
 */

import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { FlowRunner } from "@exaix/flow";
import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { resolveMemoryExecutionRoot } from "@exaix/core/config";
import {
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_NAMESPACE_INITIALIZED,
  FLOW_EVENT_NAMESPACE_READ,
  FLOW_EVENT_NAMESPACE_WRITE,
  FlowInputSource,
  FlowOutputFormat,
} from "@exaix/core";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { initTestDbService } from "@exaix/testing";
import type { JSONValue } from "@exaix/core";

class JsonAgentRunner implements IAgentExecutor {
  run(_agentRole: string, _request: IFlowStepRequest): Promise<{ thought: string; content: string; raw: string }> {
    return Promise.resolve({
      thought: "",
      content: JSON.stringify({ summary: "wave one" }),
      raw: '{"summary": "wave one"}',
    });
  }
}

class RecordingEventLogger implements IFlowEventLogger {
  readonly events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }

  eventsOfType(event: string): Array<Record<string, JSONValue | undefined>> {
    return this.events.filter((e) => e.event === event).map((e) => e.payload);
  }
}

function buildNamespaceFlow(): IFlow {
  const flow: IFlow = FlowSchema.parse({
    id: "ns-cutover-flow",
    name: "Namespace Cutover Flow",
    description: "Step 12 whole-system cutover for the unified ExecutionMemoryStore",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step-1",
        name: "Extract summary",
        agent_role: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        namespace: {
          writes: [{ key: "summary", from: "summary", mode: "write" }],
        },
      },
      {
        id: "step-2",
        name: "Read then append",
        agent_role: "agent1",
        dependsOn: ["step-1"],
        input: { source: FlowInputSource.REQUEST },
        namespace: {
          reads: [{ key: "summary", required: true }],
          writes: [{ key: "log", mode: "append" }],
        },
      },
    ],
    output: { from: ["step-2"], format: FlowOutputFormat.MARKDOWN },
    namespace: { enabled: true },
  });
  return flow;
}

Deno.test("[integration][phase-147 cutover] flow namespace reads and writes run through FlowNamespaceCoordinator onto ExecutionMemoryStore", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const eventLogger = new RecordingEventLogger();
    const runner = new FlowRunner({
      agentExecutor: new JsonAgentRunner(),
      eventLogger,
      config,
      db,
    });

    const traceId = crypto.randomUUID();
    const result = await runner.execute(buildNamespaceFlow(), {
      userPrompt: "run with namespace reads and writes",
      traceId,
    });

    assertEquals(result.success, true, "the namespace-enabled flow must complete");
    assertExists(result.namespaceArtifactPath);
    assertFalse(result.namespaceArtifactPath.endsWith("namespace.md"), "namespace.md must stay retired");

    // The coordinator's own eventing is unchanged: initialized → read → write.
    const initialized = eventLogger.eventsOfType(FLOW_EVENT_NAMESPACE_INITIALIZED);
    assertEquals(initialized.length, 1, "FLOW_EVENT_NAMESPACE_INITIALIZED must fire once");
    const reads = eventLogger.eventsOfType(FLOW_EVENT_NAMESPACE_READ);
    assertEquals(reads.length, 1, "step-2's required read must be journalled by the coordinator");
    assertEquals(reads[0].keys, ["summary"], "the read event must name the required key");
    const writes = eventLogger.eventsOfType(FLOW_EVENT_NAMESPACE_WRITE);
    assertEquals(writes.length >= 2, true, "both steps' writes must be journalled by the coordinator");

    // The unified store holds the namespace state on disk: from-path value written, append
    // applied, and the required read resolved from prior state.
    const store = new ExecutionMemoryStore(config);
    const entries = await store.readKeys(traceId, ["summary", "log"]);
    assertEquals(entries.summary, "wave one", "the from-path write must persist");
    assertEquals(entries.log, JSON.stringify({ summary: "wave one" }), "the append write must persist");

    assertEquals(
      await exists(join(config.system.root, resolveMemoryExecutionRoot(config.paths), traceId, "namespace.md")),
      false,
      "namespace.md must never be created for this run",
    );
  } finally {
    await cleanup();
  }
});
