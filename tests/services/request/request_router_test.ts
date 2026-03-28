/**
 * @module RequestRouterTest
 * @path tests/services/request_router_test.ts
 * @description Verifies the RequestRouter's orchestration logic, ensuring requests are correctly
 * dispatched to FlowRunner, AgentRunner, or default providers based on metadata.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { RequestKind } from "../../../src/shared/enums.ts";
import { RoutingError } from "../../../src/services/request_router.ts";
import { createRouterTestContext, sampleRouterRequest } from "../helpers.ts";

// Test-specific helpers are provided by tests/services/helpers.ts

// Test RequestRouter class
Deno.test("RequestRouter: routes flow requests to FlowRunner", async () => {
  const { mockFlowRunner, mockLogger, router } = createRouterTestContext();

  const request = sampleRouterRequest({ frontmatter: { flow: "code-review" } });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.FLOW);
  assertEquals(result.flowId, "code-review");
  assertEquals(mockFlowRunner.executedFlows.length, 1);
  assertEquals(mockFlowRunner.executedFlows[0].flow.id, "code-review");
  assertEquals(mockLogger.events.length, 2); // routing.flow + flow.validated
  assertEquals(mockLogger.events[0].action, "request.routing.flow");
});

Deno.test("RequestRouter: routes agent requests to AgentRunner", async () => {
  const { mockAgentRunner, mockLogger, router } = createRouterTestContext();

  const request = sampleRouterRequest({ frontmatter: { identity: "senior-coder" } });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.IDENTITY);
  assertEquals(result.identityId, "senior-coder");
  assertEquals(mockAgentRunner.executedAgents.length, 1);
  assertEquals(mockAgentRunner.executedAgents[0].blueprint.identityId, "senior-coder");
  assertEquals(mockLogger.events[0].action, "request.routing.identity");
});

Deno.test("RequestRouter: routes requests without flow/agent to default agent", async () => {
  const { mockAgentRunner, mockLogger, router } = createRouterTestContext();

  const request = sampleRouterRequest({ frontmatter: {} });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.IDENTITY);
  assertEquals(result.identityId, "default-agent");
  assertEquals(mockAgentRunner.executedAgents.length, 1);
  assertEquals(mockAgentRunner.executedAgents[0].blueprint.identityId, "default-agent");
  assertEquals(mockLogger.events[0].action, "request.routing.default");
});

Deno.test("RequestRouter: throws error for invalid flow ID", async () => {
  const { mockLogger, router } = createRouterTestContext();

  const request = sampleRouterRequest({ frontmatter: { flow: "nonexistent-flow" } });

  await assertRejects(
    () => router.route(request),
    RoutingError,
    "Flow 'nonexistent-flow' not found",
  );

  assertEquals(mockLogger.events[0].action, "request.routing.flow");
});

Deno.test("RequestRouter: throws error for conflicting flow and agent fields", async () => {
  const { router } = createRouterTestContext();

  const request = sampleRouterRequest({
    frontmatter: { flow: "code-review", identity: "senior-coder" },
  });

  await assertRejects(
    () => router.route(request),
    RoutingError,
    "Request cannot specify both 'flow' and 'identity' fields",
  );
});

Deno.test("RequestRouter: flow takes priority over agent when both present (should not happen)", async () => {
  // This test verifies that if both fields are somehow present (bypassing validation),
  // flow takes priority. In practice, this should be prevented by the conflicting fields check.
  const { mockFlowRunner, mockAgentRunner, router } = createRouterTestContext();

  const _originalRoute = router.route.bind(router);
  router.route = async function (request: any) {
    // Skip the conflicting fields check for this test
    const flowId = request.frontmatter.flow;
    const identityId = request.frontmatter.identity;

    if (flowId) {
      return await router.routeToFlow(flowId, request);
    }
    if (identityId) {
      return await router.routeToAgent(identityId, request);
    }
    return await router.routeToDefaultAgent(request);
  };

  const request = sampleRouterRequest({ frontmatter: { flow: "code-review", identity: "senior-coder" } });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.FLOW);
  assertEquals(result.flowId, "code-review");
  assertEquals(mockFlowRunner.executedFlows.length, 1);
  assertEquals(mockAgentRunner.executedAgents.length, 0); // Agent should not be called
});
