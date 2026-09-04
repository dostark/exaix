/**
 * @module DynamicAgentRoleRoutingE2ETest
 * @path tests/integration/agent_role_dynamic_routing_e2e_test.ts
 * @description Verifies Phase 74 dynamic agent-role routing using the real routing policy service,
 * ensuring request metadata drives policy selection and experiment event emission.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";

import { createRoutingPolicyService } from "../../apps/common/adapters/routing_adapter.ts";
import { createRouterTestContext, sampleRouterRequest } from "@exaix/testing";
import { RequestKind } from "@exaix/core";
import { TestEnvironment } from "./helpers/test_environment.ts";

type DynamicRoutingFrontmatter = {
  allow_dynamic_routing?: boolean;
  capability?: string;
  language?: string;
  portal_type?: string;
};

const FIXTURE_ROOT = join(Deno.cwd(), "tests", "fixtures", "dynamic_agent_role_routing");
const SELECTED_AGENT_ROLE = "senior-coder";
const DEFAULT_AGENT_ID = "default-agent";

Deno.test("Integration: dynamic agent-role routing uses routing policy rules and logs experiment events", async () => {
  const env = await TestEnvironment.create({
    configOverrides: {
      routing: {
        enabled: true,
        enable_dynamic_routing: true,
        policy_path: ".exa/routing.policy.yaml",
        experiment_salt: "phase-74-dynamic-routing",
      },
    },
  });

  try {
    const blueprintsPath = join(env.tempDir, "Blueprints", "Agents");
    await ensureDir(blueprintsPath);

    await copyFixture(
      join(FIXTURE_ROOT, `${SELECTED_AGENT_ROLE}.md`),
      join(blueprintsPath, `${SELECTED_AGENT_ROLE}.md`),
    );

    await copyFixture(
      join(FIXTURE_ROOT, `${DEFAULT_AGENT_ID}.md`),
      join(blueprintsPath, `${DEFAULT_AGENT_ID}.md`),
    );

    await ensureDir(join(env.tempDir, ".exa"));
    await copyFixture(
      join(FIXTURE_ROOT, "routing.policy.yaml"),
      join(env.tempDir, ".exa", "routing.policy.yaml"),
    );

    const routingPolicyService = createRoutingPolicyService({
      config: env.config,
      root: env.tempDir,
      db: env.db,
      experimentSalt: env.config.routing?.experiment_salt ?? "phase-74-dynamic-routing",
    });

    const { mockAgentRunner, mockLogger, router } = createRouterTestContext({
      routingPolicyService,
      defaultAgent: DEFAULT_AGENT_ID,
      blueprintsPath,
      config: env.config,
    });

    const request = sampleRouterRequest({
      frontmatter: {
        allow_dynamic_routing: true,
        capability: "code_review",
        language: "typescript",
        portal_type: "api",
      } as DynamicRoutingFrontmatter,
      body: "Review the TypeScript API implementation and recommend improvements.",
    });

    const result = await router.route(request);

    assertEquals(result.type, RequestKind.AGENT_ROLE);
    assertEquals(result.agentRole, "senior-coder");
    assertExists(mockAgentRunner.executedAgents[0]);
    assertEquals(
      mockLogger.events.some((event: { action: string }) => event.action === "routing.decision"),
      true,
    );
    assertEquals(
      mockLogger.events.some((event: { action: string }) => event.action === "routing.experiment_applied"),
      true,
    );

    const decisionEvent = mockLogger.events.find((event: { action: string }) => event.action === "routing.decision");
    assertEquals(decisionEvent?.payload?.selected_agent_role, SELECTED_AGENT_ROLE);
  } finally {
    await env.cleanup();
  }
});

async function copyFixture(sourcePath: string, destinationPath: string): Promise<void> {
  const contents = await Deno.readTextFile(sourcePath);
  await Deno.mkdir(dirname(destinationPath), { recursive: true });
  await Deno.writeTextFile(destinationPath, contents);
}
