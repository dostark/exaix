/**
 * @module AgentComposerAdapterBlueprintTest
 * @path packages/flow/tests/agent_composer_adapter_blueprint_test.ts
 * @description Phase-197 Step 4 (GAP-4) regression proof: AgentComposerAdapter.run builds
 *   the IBlueprint it hands AgentRunner via IBlueprintLoader.toLegacyBlueprint, so a
 *   flow-bound role's declared effort/thinking/default_skills reach the runner for the
 *   first time (previously dropped by the hand-built object), and the step's own
 *   effort/thinking travel as flowStep declarations with the flow request's complexity.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/agent_composer_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentComposerAdapter } from "@exaix/flow";
import type { IRunner } from "@exaix/flow/agent_composer_adapter.ts";
import type { IBlueprint } from "@exaix/execution";
import type { IFlowStepRequest } from "@exaix/flow";
import { TaskComplexity } from "@exaix/core";

const blueprintContent = `---
agent_role: test-agent
name: Test
effort: high
thinking: true
default_skills: ["skill-a", "skill-b"]
---
You are a test agent.
`;

async function setup(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "adapter-blueprint-" });
  await Deno.mkdir(join(root, "Agents"), { recursive: true });
  await Deno.writeTextFile(join(root, "Agents", "test-agent.md"), blueprintContent);
  return { root, cleanup: () => Deno.remove(root, { recursive: true }).catch(() => {}) };
}

interface ICapturedParsedRequest {
  userPrompt: string;
  context: object;
  flowStepEffort?: string;
  flowStepThinking?: boolean | string;
  taskComplexity?: string;
  taskComplexitySource?: string;
}

function makeCapturingRunner(): {
  runner: IRunner;
  blueprints: IBlueprint[];
  requests: ICapturedParsedRequest[];
} {
  const blueprints: IBlueprint[] = [];
  const requests: ICapturedParsedRequest[] = [];
  const runner = {
    run(
      blueprint: IBlueprint,
      request: Parameters<IRunner["run"]>[1],
    ) {
      blueprints.push(blueprint);
      requests.push(request as ICapturedParsedRequest);
      return Promise.resolve({ thought: "ok", content: "done", raw: "done" });
    },
  } as IRunner;
  return { runner, blueprints, requests };
}

Deno.test("AgentComposerAdapter.run carries the role's effort/thinking/default_skills via toLegacyBlueprint", async () => {
  const { root, cleanup } = await setup();
  try {
    const { runner, blueprints, requests } = makeCapturingRunner();
    const adapter = new AgentComposerAdapter(runner, root);

    const request: IFlowStepRequest = {
      userPrompt: "Do the thing",
      context: {},
      traceId: "trace-1",
      requestId: "req-1",
    };
    await adapter.run("test-agent", request);

    assertEquals(blueprints[0].effort, "high");
    assertEquals(blueprints[0].thinking, true);
    assertEquals(blueprints[0].defaultSkills, ["skill-a", "skill-b"]);
    assertEquals(blueprints[0].agentRole, "test-agent");

    const parsed = requests[0];
    assertEquals(parsed.taskComplexity, TaskComplexity.MEDIUM);
    assertEquals(parsed.taskComplexitySource, "default");
    assertEquals(parsed.flowStepEffort, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("AgentComposerAdapter.run maps the step effort/thinking and requestAnalysis complexity onto the parsed request", async () => {
  const { root, cleanup } = await setup();
  try {
    const { runner, requests } = makeCapturingRunner();
    const adapter = new AgentComposerAdapter(runner, root);

    const request: IFlowStepRequest = {
      userPrompt: "Do the thing",
      context: {},
      traceId: "trace-2",
      effort: "low",
      thinking: false,
      requestAnalysis: { complexity: TaskComplexity.COMPLEX } as never,
    };
    await adapter.run("test-agent", request);

    const parsed = requests[0];
    assertEquals(parsed.flowStepEffort, "low");
    assertEquals(parsed.flowStepThinking, false);
    assertEquals(parsed.taskComplexity, TaskComplexity.COMPLEX);
    assertEquals(parsed.taskComplexitySource, "analysis");
  } finally {
    await cleanup();
  }
});
