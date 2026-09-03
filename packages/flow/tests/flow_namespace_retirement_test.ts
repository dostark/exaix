/**
 * @module FlowNamespaceRetirementTest
 * @path packages/flow/tests/flow_namespace_retirement_test.ts
 * @description [integration] A real FlowRunner run with declared namespace writes (from-path +
 * append mode) completes end-to-end through the unified ExecutionMemoryStore: namespace.md is
 * never created (the old code path is retired, not dormant), and a simulated post-checkpoint
 * resume (fresh store instance, same trace_id, pre-existing entries on disk) reads prior
 * namespace state on its first touch.
 */

import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { FlowRunner } from "@exaix/flow";
import type { IAgentExecutor, IFlowEventLogger } from "@exaix/flow";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { resolveMemoryExecutionRoot } from "@exaix/core/config";
import { DEFAULT_FLOW_VERSION, FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import type { IFlowStepRequest } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { initTestDbService } from "@exaix/testing";

const noopLogger: IFlowEventLogger = { log: () => {} };

class JsonAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<{ thought: string; content: string; raw: string }> {
    return Promise.resolve({
      thought: "",
      content: JSON.stringify({ summary: "wave one" }),
      raw: '{"summary": "wave one"}',
    });
  }
}

function buildNamespaceFlow(): IFlow {
  const flow: IFlow = FlowSchema.parse({
    id: "ns-retirement-flow",
    name: "Namespace Retirement Flow",
    description: "Real flow run proving the FlowNamespaceService retirement",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step-1",
        name: "Extract summary",
        agent_role: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        namespace: { writes: [{ key: "summary", from: "summary", mode: "write" }] },
      },
      {
        id: "step-2",
        name: "Append log",
        agent_role: "agent1",
        dependsOn: ["step-1"],
        input: { source: FlowInputSource.REQUEST },
        namespace: { writes: [{ key: "log", mode: "append" }] },
      },
    ],
    output: { from: ["step-2"], format: FlowOutputFormat.MARKDOWN },
    namespace: { enabled: true },
  });
  return flow;
}

Deno.test("[integration] real flow run persists namespace state through ExecutionMemoryStore; namespace.md is retired", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const runner = new FlowRunner({
      agentExecutor: new JsonAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
    });

    const result = await runner.execute(buildNamespaceFlow(), { userPrompt: "run with namespace", traceId });
    assertEquals(result.success, true);
    assertExists(result.namespaceArtifactPath, "namespace-enabled flow must report its artifact path");
    assertFalse(
      result.namespaceArtifactPath.endsWith("namespace.md"),
      "the markdown namespace artifact must be retired",
    );
    assertEquals(result.namespaceArtifactPath.endsWith("scratchpad.jsonl"), true);

    // namespace.md must not exist anywhere under the run's execution directory.
    const executionRoot = join(config.system.root, resolveMemoryExecutionRoot(config.paths));
    const traceDir = join(executionRoot, traceId);
    assertEquals(await exists(join(traceDir, "namespace.md")), false, "namespace.md must never be created");

    // Simulated post-checkpoint resume: a fresh store instance over the same trace_id must
    // read prior namespace state on its first touch, before any write in the new instance.
    const resumedStore = new ExecutionMemoryStore(config);
    const resumed = await resumedStore.readKeys(traceId, ["summary", "log"]);
    assertEquals(resumed.summary, "wave one", "from-path write must be readable after resume");
    assertEquals(resumed.log, JSON.stringify({ summary: "wave one" }), "full-output append write must persist");
  } finally {
    await cleanup();
  }
});
