/**
 * @module DynamicStepApprovalToolsTest
 * @path packages/flow/tests/dynamic_step_approval_tools_test.ts
 * @description Phase 142 Step 7 — a dynamic step may use a tool only if it neither writes nor
 *   requires human approval.
 *
 *   Step 15 surfaced this as a design question: `dynamic-permission-boundary` was written to assert
 *   that validation ACCEPTS an approval-required domain tool in a dynamic step, on a Phase 79 intent
 *   that approval gates the risk at runtime instead. Settling it turned up a hole rather than a
 *   clean either/or.
 *
 *   `validateDynamicStepTools` split tools on `side_effect_scope === NONE` alone, and two
 *   config-mutating domain tools — `exaix_config_set` and `exaix_config_apply` — are declared
 *   `side_effect_scope: none`. They were therefore classified read-only and **already permitted**
 *   in dynamic steps, while `exaix_create_request` (scope `portal`) was refused. The boundary was
 *   not "no writes in a dynamic step"; it was "no tools whose side-effect scope happens to be
 *   labelled", and configuration mutation fell straight through it.
 *
 *   Decision recorded here: approval is NOT a substitute for the validation boundary. A dynamic
 *   step's tool set is chosen by a model at runtime, so the human approval prompt is the only thing
 *   between it and the effect — and a prompt an operator sees mid-run, out of context, is a weak
 *   place to make that call. `requires_human_approval` now excludes a tool from dynamic steps,
 *   which both closes the config hole and answers Phase 79 in the negative, explicitly.
 * @architectural-layer Unit
 * @related-files [packages/flow/src/flow_loader.ts, packages/mcp/src/manifest.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { validateDynamicStepTools } from "@exaix/flow";
import { FlowStepExecutionMode } from "@exaix/core";
import type { IFlowStep } from "@exaix/schemas/flow.ts";

function dynamicStep(tools: string[]): IFlowStep {
  return {
    id: "dynamic-step",
    name: "Dynamic step",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: tools,
    input: { source: "request" },
  } as IFlowStep;
}

function declaredStep(tools: string[]): IFlowStep {
  return { ...dynamicStep(tools), id: "declared-step", execution_mode: FlowStepExecutionMode.DECLARED };
}

Deno.test("[security] an approval-required tool is refused in a dynamic step even when its side-effect scope is none", () => {
  // The hole: `exaix_config_set` is `side_effect_scope: none`, so the read/write split classified it
  // read-only and let a model-chosen dynamic step mutate configuration.
  const errors = validateDynamicStepTools([dynamicStep(["exaix_config_set"])]);

  assertEquals(errors.length, 1, `expected exaix_config_set to be refused, got: ${errors.join("; ")}`);
  assert(errors[0].includes("exaix_config_set"), errors[0]);
  assert(errors[0].includes("approval"), `the message must say why: ${errors[0]}`);
});

Deno.test("[security] exaix_config_apply is refused for the same reason", () => {
  const errors = validateDynamicStepTools([dynamicStep(["exaix_config_apply"])]);
  assertEquals(errors.length, 1, `expected exaix_config_apply to be refused, got: ${errors.join("; ")}`);
});

Deno.test("[security] a write tool is still refused, and still says it is a write tool", () => {
  // The pre-existing rule must not regress: `dynamic-permission-boundary` asserts this message.
  const errors = validateDynamicStepTools([dynamicStep(["write_file"])]);
  assertEquals(errors.length, 1);
  assert(errors[0].includes("write tool"), errors[0]);
});

Deno.test("[security] an approval-required WRITE tool is reported once, not twice", () => {
  // `exaix_create_request` is both. Two errors for one tool would double-count in the score and
  // read as two separate problems.
  const errors = validateDynamicStepTools([dynamicStep(["exaix_create_request"])]);
  assertEquals(errors.length, 1, `expected a single error, got: ${errors.join("; ")}`);
});

Deno.test("[dynamic-tools] a genuinely read-only tool is still permitted", () => {
  assertEquals(validateDynamicStepTools([dynamicStep(["read_file", "list_directory", "search_files"])]), []);
});

Deno.test("[dynamic-tools] a declared step is unaffected — the restriction is about model-chosen tools", () => {
  // Declared steps have a human-authored tool list, which is the whole basis for treating them
  // differently; `exaix_config_set` there is a deliberate choice, not a runtime one.
  assertEquals(validateDynamicStepTools([declaredStep(["exaix_config_set", "write_file"])]), []);
});

Deno.test("[dynamic-tools] a step with no permitted_tools is not validated here", () => {
  // It inherits the identity's tools at runtime; this validator has nothing to check.
  const step = { ...dynamicStep([]), permitted_tools: undefined } as IFlowStep;
  assertEquals(validateDynamicStepTools([step]), []);
});
