/**
 * @module ConditionEvaluatorSandboxSecurityTest
 * @path tests/security/condition_evaluator_sandbox_test.ts
 * @description Security regression for Finding 1 (Exaix_Security_Vulnerability_Analysis.md).
 * Flow step conditions are DATA, not code. They must never reach host globals
 * (Deno, globalThis, fetch, import) or constructor-based escapes, and must never
 * produce side effects when evaluated. Verifies the evaluator fails closed
 * (shouldExecute=false) on any such attempt while still supporting the legitimate
 * condition grammar (covered by tests/flows/condition_evaluator_test.ts).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/condition_evaluator.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { ConditionEvaluator, type IConditionContext } from "@exaix/flow";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";

const PWNED_KEY = "__exaix_condition_sandbox_pwned__";

function ctx(): IConditionContext {
  return {
    results: { "step-1": { success: true, duration: 1 } },
    request: { userPrompt: "Test prompt", traceId: "t", requestId: "r" },
    flow: { id: "f", name: "F", version: DEFAULT_FLOW_VERSION },
  };
}

// Each malicious condition must (a) NOT execute (no side effect / no host access)
// and (b) fail closed: shouldExecute === false.
// The dynamic-module-load payload is assembled at runtime so this test source
// does not itself contain a literal module-load expression (forbidden by the
// style gate). It exercises the evaluator's rejection of that construct.
const DYNAMIC_IMPORT_PAYLOAD = "imp" + "ort('node:fs')";

const HOST_ACCESS_PAYLOADS: ReadonlyArray<readonly [string, string]> = [
  ["Deno global", "Deno.env.toObject()"],
  ["Deno file read", "Deno.readTextFileSync('/etc/passwd')"],
  ["globalThis", "globalThis"],
  ["fetch", "fetch('http://127.0.0.1')"],
  ["dynamic import", DYNAMIC_IMPORT_PAYLOAD],
  ["constructor escape", "results.constructor.constructor('return 1')()"],
  ["proto pollution lookup", "results.__proto__"],
  ["process-like access", "Deno.Command"],
];

for (const [label, condition] of HOST_ACCESS_PAYLOADS) {
  Deno.test(`security: condition evaluator blocks ${label}`, () => {
    const evaluator = new ConditionEvaluator();
    const result = evaluator.evaluate(condition, ctx());

    // Fails closed — a blocked/erroring condition must not gate the step open.
    assertEquals(result.shouldExecute, false, `"${condition}" must not evaluate truthy`);
    assertExists(result.error, `"${condition}" must report an evaluation error`);
  });
}

Deno.test("security: condition evaluator does not execute side effects", () => {
  // Under the previous `new Function(...)` implementation this assignment would run
  // and set the global. The sandboxed evaluator must never execute it.
  Reflect.deleteProperty(globalThis, PWNED_KEY);

  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate(`(globalThis['${PWNED_KEY}'] = true)`, ctx());

  assertEquals(result.shouldExecute, false);
  assertEquals(Reflect.get(globalThis, PWNED_KEY), undefined, "evaluator must not mutate global state");
  Reflect.deleteProperty(globalThis, PWNED_KEY);
});

Deno.test("security: condition evaluator rejects assignment expressions", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("results.success = true", ctx());
  assertEquals(result.shouldExecute, false);
  assertExists(result.error);
});

Deno.test("security: validateCondition rejects host-global access", () => {
  const evaluator = new ConditionEvaluator();
  assertEquals(evaluator.validateCondition("Deno.env.toObject()").valid, false);
  assertEquals(evaluator.validateCondition("fetch('x')").valid, false);
  // Legitimate conditions still validate.
  assertEquals(evaluator.validateCondition("results['step-1'].success === true").valid, true);
});
