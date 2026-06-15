/**
 * @module GuardrailSchemaTest
 * @path packages/schemas/tests/guardrail_test.ts
 * @description Unit tests for guardrail schemas (Phase 107 Step 1).
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  GuardrailConfigSchema,
  GuardrailIncidentSchema,
  GuardrailPolicySchema,
  GuardrailSeveritySchema,
  GuardrailVerdictSchema,
} from "../mod.ts";
import { ZPlanAmendmentTrigger } from "../mod.ts";

Deno.test("guardrail-config-defaults", () => {
  const config = GuardrailConfigSchema.parse({});
  assertEquals(config.enabled, false);
  assertEquals(config.check_interval_iterations, 1);
  assertEquals(config.screen_final_output, true);
  assertEquals(config.policies, []);
});

Deno.test("guardrail-config-roundtrip", () => {
  const input = {
    enabled: true,
    policies: [{
      policy_id: "test-policy",
      description: "Test policy",
      blueprint: "test-blueprint",
      severity: "block",
    }],
    check_interval_iterations: 2,
    screen_final_output: false,
  };
  const parsed = GuardrailConfigSchema.parse(input);
  assertEquals(parsed.enabled, true);
  assertEquals(parsed.policies.length, 1);
  assertEquals(parsed.policies[0].policy_id, "test-policy");
  assertEquals(parsed.policies[0].severity, "block");
  assertEquals(parsed.check_interval_iterations, 2);
  assertEquals(parsed.screen_final_output, false);
});

Deno.test("guardrail-incident-rejects-bad-enum", () => {
  try {
    GuardrailIncidentSchema.parse({
      trace_id: crypto.randomUUID(),
      policy_id: "p1",
      iteration: 0,
      verdict: "invalid",
      severity: "block",
    });
    throw new Error("Expected parse to fail");
  } catch (e) {
    assertExists(e);
  }
});

Deno.test("guardrail-policy-defaults", () => {
  const policy = GuardrailPolicySchema.parse({
    policy_id: "p1",
    description: "desc",
    blueprint: "bp",
  });
  assertEquals(policy.severity, "block");
  assertEquals(policy.model_slot, "fast");
});

Deno.test("amendment-trigger-accepts-guardrail-source", () => {
  const trigger = ZPlanAmendmentTrigger.parse({
    source: "guardrail_violation",
    stepId: "step-1",
    reason: "Policy violation detected",
  });
  assertEquals(trigger.source, "guardrail_violation");
});

Deno.test("guardrail-severity-schema", () => {
  assertEquals(GuardrailSeveritySchema.parse("warn"), "warn");
  assertEquals(GuardrailSeveritySchema.parse("block"), "block");
});

Deno.test("guardrail-verdict-schema", () => {
  assertEquals(GuardrailVerdictSchema.parse("pass"), "pass");
  assertEquals(GuardrailVerdictSchema.parse("violation"), "violation");
});
