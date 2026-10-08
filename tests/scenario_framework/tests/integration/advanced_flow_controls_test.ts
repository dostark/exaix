/**
 * @module AdvancedFlowControlsTest
 * @path tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts
 * @description Executes Phase 205 flow controls and blueprints on real daemons with strict keyed fixtures.
 *   Each case reconciles its observed model calls and started steps with its expected-call manifest.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/portal, @exaix/testing]
 * @related-files [tests/scenario_framework/scenarios/agent_flows/gate_halt.yaml, tests/scenario_framework/scenarios/agent_flows/gate_continue_warning.yaml]
 */
import { runAdvancedFlowCase } from "../helpers/advanced_flow_case.ts";

for (
  const [file, scenarioId, action, status, phaseStep, evaluations, iterations, edition = "solo"] of [
    ["gate_halt", "gate-halt", "halted", "failed", 1, 1, 0],
    ["gate_continue_warning", "gate-continue-warning", "continued-with-warning", "planned", 1, 1, 0],
    ["gate_retry", "gate-retry", "passed", "planned", 2, 2, 1],
    ["gate_retry_exhausted", "gate-retry-exhausted", "halted", "failed", 2, 3, 2],
    ["gate_retry_budget", "gate-retry-budget", "retry", "failed", 2, 1, 0],
    ["branch_routing", "branch-routing", "bug", "planned", 3, 0, 0],
    ["architecture_decision", "architecture-decision", "majority", "planned", 4, 0, 0, "team"],
    ["architecture_decision_solo", "architecture-decision-solo", "unavailable", "failed", 4, 0, 0, "solo"],
    ["self_correcting_implementation", "self-correcting-implementation", "passed", "planned", 5, 2, 1],
    ["triage_router", "triage-router", "bug", "planned", 6, 0, 0],
    ["triage_router_docs", "triage-router-docs", "docs", "planned", 6, 0, 0],
    ["parallel_research", "parallel-research", "continued-with-warning", "planned", 7, 1, 0, "team"],
    ["guarded_change", "guarded-change", "halted", "failed", 8, 1, 0, "team"],
    ["guarded_change_pass", "guarded-change-pass", "passed", "planned", 8, 1, 0, "team"],
  ] as const
) {
  Deno.test({
    name: `[phase205 step${phaseStep}] ${scenarioId} real ${edition} daemon`,
    ignore: phaseStep !== 4 && Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      await runAdvancedFlowCase({ file, scenarioId, action, status, phaseStep, evaluations, iterations, edition });
    },
  });
}
