/**
 * @module FlowRunnerFlowIdTest
 * @path packages/flow/tests/flow_runner_flow_id_test.ts
 * @description Phase 206 Step 5 — the flow id a step request already carries is forwarded, not
 *   recreated, into the AgentRunner request, so skill usage rows attribute each model call to its
 *   flow and step. A step without a flow id forwards none.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/agent_composer_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentComposerAdapter } from "@exaix/flow";
import type { IRunner } from "@exaix/flow/agent_composer_adapter.ts";
import type { IFlowStepRequest } from "@exaix/flow";
import type { IBlueprint } from "@exaix/execution";

const BLUEPRINT = "---\nagent_role: test-agent\nname: Test\n---\nYou are a test agent.\n";

interface ICapturedRequest {
  portal?: string;
  flowId?: string;
  flowStepId?: string;
  traceId?: string;
}

async function withAdapter(
  fn: (adapter: AgentComposerAdapter, captured: ICapturedRequest[]) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "adapter-flow-id-" });
  try {
    await Deno.mkdir(join(root, "Agents"), { recursive: true });
    await Deno.writeTextFile(join(root, "Agents", "test-agent.md"), BLUEPRINT);
    const captured: ICapturedRequest[] = [];
    const runner = {
      run(_blueprint: IBlueprint, request: Parameters<IRunner["run"]>[1]) {
        captured.push(request as ICapturedRequest);
        return Promise.resolve({ thought: "ok", content: "done", raw: "done" });
      },
    } as IRunner;
    await fn(new AgentComposerAdapter(runner, root), captured);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("AgentComposerAdapter.run forwards the existing flow id and step id into the runner request", async () => {
  await withAdapter(async (adapter, captured) => {
    const request: IFlowStepRequest = {
      userPrompt: "Do the thing",
      context: {},
      traceId: "trace-1",
      flowId: "feature-development",
      flowStepId: "implement",
    };
    await adapter.run("test-agent", request);
    assertEquals(captured[0].flowId, "feature-development");
    assertEquals(captured[0].flowStepId, "implement");
    assertEquals(captured[0].traceId, "trace-1");
  });
});

Deno.test("AgentComposerAdapter.run forwards no flow id when the step request has none", async () => {
  await withAdapter(async (adapter, captured) => {
    await adapter.run("test-agent", { userPrompt: "Do the thing", context: {}, traceId: "trace-2" });
    assertEquals(captured[0].flowId, undefined);
  });
});

Deno.test("AgentComposerAdapter.run forwards the flow's portal so project skills resolve, and none when absent", async () => {
  await withAdapter(async (adapter, captured) => {
    await adapter.run("test-agent", { userPrompt: "Do it", context: {}, traceId: "trace-3", portal: "Alpha" });
    await adapter.run("test-agent", { userPrompt: "Do it", context: {}, traceId: "trace-4" });
    assertEquals(captured[0].portal, "Alpha");
    assertEquals(captured[1].portal, undefined);
  });
});
