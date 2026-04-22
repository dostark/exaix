/**
 * @module RoutingPolicySchemaTest
 * @path tests/schemas/routing_policy_schema_test.ts
 * @description Unit tests for the routing policy Zod schema.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ZRoutingPolicy, ZRoutingPolicyDecision } from "@exaix/schemas/routing_policy.ts";

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
          identityId: "senior-coder",
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
    assertEquals(result.data.rules[0].prefer.identityId, "senior-coder");
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
        prefer: { identityId: "" },
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
    selectedIdentityId: "default-agent",
    selectedVersion: "1.0.0",
    strategy: "explicit",
    candidates: [],
    rationale: "Explicit identity used",
    decidedAt: new Date().toISOString(),
  });

  assertEquals(result.success, true);
});
