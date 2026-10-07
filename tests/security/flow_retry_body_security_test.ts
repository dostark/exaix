/**
 * @module FlowRetryBodySecurityTest
 * @path tests/security/flow_retry_body_security_test.ts
 * @description Rejects unsupported retry effects and retains authorized paths on React iterations.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/flow, @exaix/portal, @exaix/testing]
 * @related-files [packages/flow/src/loop_body.ts, packages/flow/src/flow_runner.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ExecutionStrategyName, FlowStepType, PortalOperation } from "@exaix/core";
import { FlowExecutionError, FlowRunner, GateEvaluator } from "@exaix/flow";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import { GateTestLogger } from "../../packages/flow/tests/helpers/gate_controls.ts";
import {
  gateRetryFlow,
  RetryTestAgent,
  RetryTestJudge,
} from "../../packages/flow/tests/helpers/gate_retry_controls.ts";
for (const type of [FlowStepType.VOTING_GROUP, FlowStepType.CONSENSUS, FlowStepType.SESSION_DELEGATE_CYCLE]) {
  Deno.test(`[security] ${type} retry body is rejected before execution`, async () => {
    const flow = gateRetryFlow();
    flow.steps[0].type = type;
    const agent = new RetryTestAgent();
    const judge = new RetryTestJudge([1]);
    await assertRejects(
      () =>
        new FlowRunner({
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(flow, { userPrompt: "Generate" }),
      FlowExecutionError,
    );
    assertEquals(agent.calls, []);
    assertEquals(judge.calls, 0);
  });
}
Deno.test("[security] CLI-delegating retry body never reaches its launcher", async () => {
  const flow = gateRetryFlow();
  flow.steps[0].strategy = ExecutionStrategyName.CLI_DELEGATE;
  let launches = 0;
  await assertRejects(
    () =>
      new FlowRunner({
        agentExecutor: {
          run: () => Promise.reject(new Error("Unexpected agent")),
          runWithStrategy: () => {
            launches++;
            return Promise.reject(new Error("Unexpected launcher"));
          },
        },
        gateEvaluator: new GateEvaluator(new RetryTestJudge([1])),
        eventLogger: new GateTestLogger(),
      })
        .execute(flow, { userPrompt: "Generate" }),
    FlowExecutionError,
  );
  assertEquals(launches, 0);
});
Deno.test("[security] React retry calls retain the portal, trace and authorized write path", async () => {
  const env = await initTestDbService();
  try {
    const target = join(env.tempDir, "worktree");
    await Deno.mkdir(target);
    const config = createMockConfig(env.tempDir, {
      portals: [{
        alias: "Allowed",
        target_path: target,
        default_branch: "main",
        agents_allowed: ["senior-coder"],
        operations: [PortalOperation.READ, PortalOperation.WRITE],
      }],
    });
    const permissions = new PortalPermissionsService(config.portals!);
    const resolver = new PathResolver(config);
    const paths: string[] = [];
    const traceId = crypto.randomUUID();
    const flow = gateRetryFlow();
    flow.steps[0].strategy = ExecutionStrategyName.REACT;
    const fallback = new RetryTestAgent();
    await new FlowRunner({
      agentExecutor: {
        run: fallback.run.bind(fallback),
        runWithStrategy: async (role, request, strategy) => {
          assertEquals(strategy, ExecutionStrategyName.REACT);
          assertEquals(request.traceId, traceId);
          assertEquals(request.portal, "Allowed");
          assertEquals(permissions.checkOperationAllowed(request.portal!, role, PortalOperation.WRITE).allowed, true);
          const path = await resolver.resolve("@Allowed/draft.md");
          paths.push(path);
          await Deno.writeTextFile(path, `Draft ${paths.length}`);
          return { thought: "", content: await Deno.readTextFile(path), raw: "" };
        },
      },
      gateEvaluator: new GateEvaluator(new RetryTestJudge([0.2, 1])),
      eventLogger: new GateTestLogger(),
    })
      .execute(flow, { userPrompt: "Generate", traceId, portal: "Allowed" });
    assertEquals(paths, [join(target, "draft.md"), join(target, "draft.md")]);
    assertEquals(await Deno.readTextFile(paths[0]), "Draft 2");
  } finally {
    await env.cleanup();
  }
});
