/**
 * @module AgentExecutorAdapterTest
 * @path packages/flow/tests/agent_executor_adapter_test.ts
 * @description Tests for AgentOrchestratorAdapter — bridges IAgentRunner into
 * FlowRunner's IAgentExecutor interface.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { AgentOrchestratorAdapter, type IRunner } from "../src/agent_executor_adapter.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IFlowStepRequest } from "../src/flow_runner.ts";
import type { IBlueprint } from "@exaix/execution";

interface IRunnerRequest {
  userPrompt: string;
  context: Record<string, string>;
  scenarioId?: string;
  stepId?: string;
  flowStepId?: string;
}

function makeFakeRunner(): IRunner {
  return {
    run(
      _blueprint: IBlueprint,
      _request: IRunnerRequest,
    ): Promise<IAgentExecutionResult> {
      return Promise.resolve({ thought: "", content: "", raw: "" });
    },
  };
}

Deno.test("AgentOrchestratorAdapter runs an agent and returns IAgentExecutionResult", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "adapter-test-" });
  const identitiesDir = `${tmpDir}/Blueprints/Agents`;
  await Deno.mkdir(identitiesDir, { recursive: true });
  await Deno.writeTextFile(
    `${identitiesDir}/test-agent.md`,
    `---
agent_role: "test-agent"
name: "Test Agent"
model: "mock:test"
---\nTest system prompt`,
  );

  try {
    const fakeRunner: IRunner = {
      run(blueprint: IBlueprint): Promise<IAgentExecutionResult> {
        assertEquals(blueprint.identityId, "test-agent");
        assertEquals(blueprint.systemPrompt, "Test system prompt");
        return Promise.resolve({ thought: "thinking", content: "result", raw: "raw result" });
      },
    };

    const adapter = new AgentOrchestratorAdapter(fakeRunner, identitiesDir);
    const request: IFlowStepRequest = {
      userPrompt: "do something",
      context: {},
      traceId: "test-trace",
      requestId: "test-req",
    };

    const result = await adapter.run("test-agent", request);
    assertEquals(result.content, "result");
    assertEquals(result.thought, "thinking");
    assertEquals(result.raw, "raw result");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentOrchestratorAdapter threads scenarioId/stepId/flowStepId into the runner's request (Phase 157)", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "adapter-test-" });
  const identitiesDir = `${tmpDir}/Blueprints/Agents`;
  await Deno.mkdir(identitiesDir, { recursive: true });
  await Deno.writeTextFile(
    `${identitiesDir}/test-agent.md`,
    `---
agent_role: "test-agent"
name: "Test Agent"
model: "mock:test"
---\nTest system prompt`,
  );

  try {
    let received: IRunnerRequest | undefined;
    const capturingRunner: IRunner = {
      run(
        _blueprint: IBlueprint,
        request: IRunnerRequest,
      ): Promise<IAgentExecutionResult> {
        received = request;
        return Promise.resolve({ thought: "", content: "", raw: "" });
      },
    };

    const adapter = new AgentOrchestratorAdapter(capturingRunner, identitiesDir);
    const request: IFlowStepRequest = {
      userPrompt: "do something",
      context: {},
      scenarioId: "feature_development",
      stepId: "submit-flow-request",
      flowStepId: "define-endpoints",
    };

    await adapter.run("test-agent", request);
    assertEquals(received?.scenarioId, "feature_development");
    assertEquals(received?.stepId, "submit-flow-request");
    assertEquals(received?.flowStepId, "define-endpoints");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentOrchestratorAdapter throws when blueprint is not found", async () => {
  const fakeRunner = makeFakeRunner();
  const adapter = new AgentOrchestratorAdapter(fakeRunner, "/nonexistent/path");
  const request: IFlowStepRequest = { userPrompt: "test", context: {} };

  await assertRejects(
    () => adapter.run("nonexistent-agent", request),
    Error,
    "Blueprint not found",
  );
});
