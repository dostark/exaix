/**
 * @module GateConfigTest
 * @path tests/flows/gate_config_test.ts
 * @description Unit tests verifying that both GateEvaluateSchema and
 * GateConfigSchema accept the `includeRequestCriteria` flag added in Phase 48 Step 5.
 */

import { assertEquals } from "@std/assert";
import { GateEvaluateSchema } from "@exaix/schemas/flow.ts";
import { GateConfigSchema } from "@exaix/flow";
import { FlowGateOnFail } from "@exaix/core";

const BASE_GATE_EVALUATE = {
  identity: "judge-agent",
  criteria: ["CORRECTNESS", "COMPLETENESS"],
  threshold: 0.8,
  onFail: FlowGateOnFail.HALT,
  maxRetries: 3,
};

const BASE_GATE_CONFIG = {
  identity: "judge-agent",
  criteria: ["CORRECTNESS", "COMPLETENESS"],
  threshold: 0.8,
  onFail: FlowGateOnFail.HALT,
  maxRetries: 3,
};

Deno.test("[GateEvaluateSchema] validates includeRequestCriteria field", () => {
  const result = GateEvaluateSchema.parse({
    ...BASE_GATE_EVALUATE,
    includeRequestCriteria: true,
  });
  assertEquals(result.includeRequestCriteria, true);
});

Deno.test("[GateEvaluateSchema] defaults includeRequestCriteria to false", () => {
  const result = GateEvaluateSchema.parse(BASE_GATE_EVALUATE);
  assertEquals(result.includeRequestCriteria, false);
});

Deno.test("[GateEvaluateSchema] backward compatible with existing YAML configs", () => {
  const result = GateEvaluateSchema.parse(BASE_GATE_EVALUATE);
  assertEquals(result.identity, BASE_GATE_EVALUATE.identity);
  assertEquals(result.criteria, BASE_GATE_EVALUATE.criteria);
  assertEquals(result.threshold, BASE_GATE_EVALUATE.threshold);
  assertEquals(result.onFail, FlowGateOnFail.HALT);
});

Deno.test("[GateConfigSchema] validates includeRequestCriteria field", () => {
  const result = GateConfigSchema.parse({
    ...BASE_GATE_CONFIG,
    includeRequestCriteria: true,
  });
  assertEquals(result.includeRequestCriteria, true);
});

Deno.test("[GateConfigSchema] defaults includeRequestCriteria to false", () => {
  const result = GateConfigSchema.parse(BASE_GATE_CONFIG);
  assertEquals(result.includeRequestCriteria, false);
});
