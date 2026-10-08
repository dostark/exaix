/**
 * @module HitlGovernanceE2ESecurityTest
 * @path tests/integration/hitl_governance_e2e_security_test.ts
 * @description Security-focused HITL governance tests: canonical and legacy tool-name
 *   policies request approval after renaming, and an invalid native policy blocks registry
 *   execution before approval.
 * @architectural-layer Test
 * @related-files [packages/tool-runtime/src/tool_registry.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { HitlPolicyEvaluator } from "@exaix-team/hitl";
import { ApproveTrackingInterceptor, withRegistry } from "./helpers/hitl_governance_helpers.ts";

describe("[hitl] ToolRegistry path — E2E HITL wiring", () => {
  it("[security] canonical task and legacy search policies request approval after renaming", async () => {
    for (const [rule, name] of [["run_deno_task", "run_deno_task"], ["grep_search", "search_text"]]) {
      const interceptor = new ApproveTrackingInterceptor();
      await withRegistry(new HitlPolicyEvaluator([{ tool: rule }]), interceptor, undefined, async (registry) => {
        await registry.execute(name, { path: "/outside/allowed", task: "fmt", pattern: "test" });
        assertEquals(interceptor.requests.length, 1);
        assertEquals(interceptor.requests[0].toolName, name);
      });
    }
  });

  it("[security] invalid native policy blocks registry execution before approval", async () => {
    const interceptor = new ApproveTrackingInterceptor();
    await withRegistry(new HitlPolicyEvaluator([{ tool: "deno_task" }]), interceptor, undefined, async (registry) => {
      await assertRejects(
        () => registry.execute("run_deno_task", { task: "fmt" }),
        Error,
        "Invalid native tool name",
      );
      assertEquals(interceptor.requests.length, 0);
    });
  });
});
