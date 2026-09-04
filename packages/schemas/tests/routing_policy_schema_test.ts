/**
 * @module RoutingPolicySchemaTest
 * @path packages/schemas/tests/routing_policy_schema_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Unit tests for the routing policy Zod schema.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ZRoutingPolicy, ZRoutingPolicyDecision } from "@exaix/schemas";

Deno.test("[RoutingPolicySchema] validates complete valid policy", () => {
  const policy = {
    version: "1.0",
    defaultMode: "policy_first",
    allowExperiments: true,
    rules: [
      {
        ruleId: "test-rule",
        priority: 10,
        match: {
          capability: "code_generation",
          taskType: "implementation",
          language: "typescript",
          tags: ["api"],
        },
        prefer: {
          agentRole: "senior-coder",
          version: "2.0",
          trafficSplit: 0.1,
        },
      },
    ],
  };

  const result = ZRoutingPolicy.safeParse(policy);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.rules.length, 1);
    assertEquals(result.data.rules[0].prefer.agentRole, "senior-coder");
  }
});

Deno.test("[RoutingPolicySchema] rejects invalid policy values", () => {
  const result = ZRoutingPolicy.safeParse({
    version: "1.0",
    defaultMode: "invalid_mode",
    allowExperiments: "yes",
    rules: [
      {
        ruleId: "",
        priority: -5,
        match: { capability: "" },
        prefer: { agentRole: "" },
      },
    ],
  });

  assertEquals(result.success, false);
  if (!result.success) {
    assertExists(result.error.issues.find((issue) => issue.path.join(".") === "defaultMode"));
    assertExists(result.error.issues.find((issue) => issue.path.join(".") === "allowExperiments"));
    assertExists(result.error.issues.find((issue) => issue.path.join(".") === "rules.0.ruleId"));
  }
});

Deno.test("[RoutingPolicyDecisionSchema] validates a minimal decision", () => {
  const result = ZRoutingPolicyDecision.safeParse({
    selectedAgentRole: "default-agent",
    selectedVersion: "1.0.0",
    strategy: "explicit",
    candidates: [],
    rationale: "Explicit agent role used",
    decidedAt: new Date().toISOString(),
  });

  assertEquals(result.success, true);
});
