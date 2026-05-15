// deno-lint-ignore-file no-explicit-any
/**
 * @module RequestRouterTest
 * @path tests/services/request/request_router_test.ts
 * @description Verifies the RequestRouter's orchestration logic, ensuring requests are correctly
 * dispatched to FlowRunner, AgentRunner, or default providers based on metadata.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { RequestKind } from "@exaix/core";
import { RoutingError } from "../../../src/services/request/request_router.ts";
import { createRouterTestContext, sampleRouterRequest } from "../helpers.ts";
import { createMockConfig } from "../../helpers/config.ts";
import type { IRequestFrontmatter } from "@exaix/core/request/mod.ts";
type RoutingContext = {
  explicitIdentityId?: string;
  explicitVersion?: string;
  requestText?: string;
  requestAnalysis?: any;
  portalName?: string;
  flowStepId?: string;
  matchCriteria?: {
    capability?: string;
    complexityMin?: number;
    complexityMax?: number;
    language?: string;
    taskType?: string;
    portalType?: string;
    tags?: string[];
  };
  traceId?: string;
  allowDynamicRouting?: boolean;
};

type TestRouterFrontmatter = Partial<IRequestFrontmatter> & {
  [key: string]: any;
};

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
  router.route = async function (request: Parameters<typeof router.route>[0]) {
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

Deno.test("RequestRouter: applies routing policy service for explicit identity when dynamic routing is enabled", async () => {
  const routingPolicyService = {
    selectIdentity: () =>
      Promise.resolve({
        selectedIdentityId: "default-agent",
        selectedVersion: "1.0.0",
        strategy: "policy" as const,
        candidates: [],
        rationale: "Dynamic routing selected default agent",
        decidedAt: new Date().toISOString(),
      }),
  };

  const { mockAgentRunner, mockLogger, router } = createRouterTestContext({
    routingPolicyService,
  });

  const request = sampleRouterRequest({
    frontmatter: { identity: "senior-coder", allow_dynamic_routing: true },
  });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.IDENTITY);
  assertEquals(result.identityId, "default-agent");
  assertEquals(mockAgentRunner.executedAgents[0].blueprint.identityId, "default-agent");
  assertEquals(mockLogger.events.some((event) => event.action === "routing.decision"), true);
  const decisionEvent = mockLogger.events.find((event) => event.action === "routing.decision");
  assertEquals(decisionEvent?.payload?.selected_identity_id, "default-agent");
  assertEquals(decisionEvent?.payload?.allow_dynamic_routing, true);
});

Deno.test("RequestRouter: logs fallback_used when routing policy service fails", async () => {
  const routingPolicyService = {
    selectIdentity: () => Promise.reject(new Error("policy service unavailable")),
  };

  const { mockAgentRunner, mockLogger, router } = createRouterTestContext({
    routingPolicyService,
  });

  const request = sampleRouterRequest({
    frontmatter: { identity: "senior-coder", allow_dynamic_routing: true },
  });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.IDENTITY);
  assertEquals(result.identityId, "senior-coder");
  assertEquals(mockAgentRunner.executedAgents[0].blueprint.identityId, "senior-coder");
  assertEquals(mockLogger.events.some((event) => event.action === "routing.fallback_used"), true);
  const fallbackEvent = mockLogger.events.find((event) => event.action === "routing.fallback_used");
  assertEquals(fallbackEvent?.payload?.fallback_identity_id, "senior-coder");
  assertEquals(fallbackEvent?.payload?.reason, "policy service unavailable");
});

Deno.test("RequestRouter: logs fallback_used when routing policy returns a fallback decision", async () => {
  let receivedContext: RoutingContext | null = null;
  const routingPolicyService = {
    selectIdentity: (context: RoutingContext) => {
      receivedContext = context;
      return Promise.resolve({
        selectedIdentityId: "default-agent",
        selectedVersion: "1.0.0",
        strategy: "capability_fallback" as const,
        candidates: [],
        rationale: "Fallback candidate selected",
        decidedAt: new Date().toISOString(),
      });
    },
  };

  const { mockLogger, router } = createRouterTestContext({
    routingPolicyService,
  });

  const request = sampleRouterRequest({
    frontmatter: { allow_dynamic_routing: true },
  });

  const result = await router.route(request);

  assertEquals(result.identityId, "default-agent");
  assertEquals(mockLogger.events.some((event) => event.action === "routing.fallback_used"), true);
  const fallbackEvent = mockLogger.events.find((event) => event.action === "routing.fallback_used");
  assertEquals(fallbackEvent?.payload?.fallback_identity_id, "default-agent");
  const fallbackContext = receivedContext as RoutingContext | null;
  assertEquals(fallbackContext?.matchCriteria !== undefined, true);
});

Deno.test("RequestRouter: logs experiment_applied when routing policy returns an experiment decision", async () => {
  const routingPolicyService = {
    selectIdentity: () =>
      Promise.resolve({
        selectedIdentityId: "default-agent",
        selectedVersion: "1.0.0",
        strategy: "policy" as const,
        experimentApplied: true,
        experimentBucket: 0.32,
        candidates: [],
        rationale: "Experiment applied",
        decidedAt: new Date().toISOString(),
      }),
  };

  const { mockLogger, router } = createRouterTestContext({
    routingPolicyService,
  });

  const request = sampleRouterRequest({
    frontmatter: { allow_dynamic_routing: true },
  });

  const result = await router.route(request);

  assertEquals(result.identityId, "default-agent");
  assertEquals(mockLogger.events.some((event) => event.action === "routing.experiment_applied"), true);
  const experimentEvent = mockLogger.events.find((event) => event.action === "routing.experiment_applied");
  assertEquals(experimentEvent?.payload?.selected_identity_id, "default-agent");
  assertEquals(experimentEvent?.payload?.experiment_bucket, 0.32);
});

Deno.test("RequestRouter: forwards full routing context to routing policy service", async () => {
  let receivedContext: RoutingContext | null = null;

  const routingPolicyService = {
    selectIdentity: (context: RoutingContext) => {
      receivedContext = context;
      return Promise.resolve({
        selectedIdentityId: "default-agent",
        selectedVersion: "1.0.0",
        strategy: "policy" as const,
        candidates: [],
        rationale: "Routing context captured",
        decidedAt: new Date().toISOString(),
      });
    },
  };

  const { router } = createRouterTestContext({
    routingPolicyService,
  });

  const request = sampleRouterRequest({
    frontmatter: {
      allow_dynamic_routing: true,
      capability: "code_review",
      language: "typescript",
      task_type: "implementation",
      portal_type: "api",
      portal: "portal-a",
      identity_version: "1.2.3",
    } as TestRouterFrontmatter,
    body: "Use the code review agent.",
  });

  await router.route(request);

  const context = receivedContext as RoutingContext | null;

  assertEquals(context?.requestText ?? undefined, "Use the code review agent.");
  assertEquals(context?.matchCriteria?.language, "typescript");
  assertEquals(context?.matchCriteria?.taskType, "implementation");
  assertEquals(context?.matchCriteria?.portalType, "api");
  assertEquals(context?.requestAnalysis ?? null, null);
});

Deno.test("RequestRouter: applies routing policy service for default routing when global dynamic routing is enabled", async () => {
  const routingPolicyService = {
    selectIdentity: () =>
      Promise.resolve({
        selectedIdentityId: "senior-coder",
        selectedVersion: "1.0.0",
        strategy: "policy" as const,
        candidates: [],
        rationale: "Dynamic default routing selected senior coder",
        decidedAt: new Date().toISOString(),
      }),
  };

  const config = createMockConfig("/tmp/exaix-request-router-test", {
    routing: {
      enabled: true,
      policy_path: ".exaix/routing.policy.yaml",
      experiment_salt: "exaix-routing-experiments",
      enable_dynamic_routing: true,
    },
  });
  const { mockAgentRunner, mockLogger, router } = createRouterTestContext({
    config,
    routingPolicyService,
  });

  const request = sampleRouterRequest({ frontmatter: {} });

  const result = await router.route(request);

  assertEquals(result.type, RequestKind.IDENTITY);
  assertEquals(result.identityId, "senior-coder");
  assertEquals(mockAgentRunner.executedAgents[0].blueprint.identityId, "senior-coder");
  assertEquals(mockLogger.events.some((event) => event.action === "routing.decision"), true);
  const decisionEvent = mockLogger.events.find((event) => event.action === "routing.decision");
  assertEquals(decisionEvent?.payload?.selected_identity_id, "senior-coder");
  assertEquals(decisionEvent?.payload?.allow_dynamic_routing, true);
});
