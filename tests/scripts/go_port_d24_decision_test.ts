/**
 * @module GoPortD24DecisionTest
 * @path tests/scripts/go_port_d24_decision_test.ts
 * @description Validates the D24 decision rule and the Phase 214 readiness gate.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/d24_decision.ts, scripts/go_port/phase214_ready.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { decide, type ID24Input } from "../../scripts/go_port/d24_decision.ts";
import { readinessErrors } from "../../scripts/go_port/phase214_ready.ts";

function packageCost(overrides: Partial<ID24Input["packages"][number]> = {}): ID24Input["packages"][number] {
  return {
    package: "p",
    arm: "agent-only",
    extent: "conversion",
    hours: {
      tool_development: 1,
      ts_preparation: 1,
      review: 1,
      test_repair: 0,
      parity_debugging: 0,
      marker_resolution: 0,
    },
    total: 3,
    hazards: [],
    construct_family: "utility",
    ...overrides,
  };
}

function input(overrides: Partial<ID24Input> = {}): ID24Input {
  return {
    budget_hours: 10,
    budget_spend_usd: 100,
    measured_spend_usd: 50,
    packages: [packageCost()],
    ...overrides,
  };
}

Deno.test("d24-proceed: complete evidence under both budgets proceeds", () => {
  const decision = decide(input());
  assertEquals(decision.decision, "proceed");
  assertEquals(decision.hours_multiple, 0.3);
  assertEquals(decision.spend_multiple, 0.5);
});

Deno.test("d24-both-metrics: one over-budget metric forces revise", () => {
  const hoursOver = decide(input({ packages: [packageCost({ total: 30 })] }));
  assertEquals(hoursOver.decision, "revise");
  const spendOver = decide(input({ measured_spend_usd: 250 }));
  assertEquals(spendOver.decision, "revise");
});

Deno.test("d24-stop: both metrics over budget stop the port", () => {
  const decision = decide(input({ packages: [packageCost({ total: 30 })], measured_spend_usd: 250 }));
  assertEquals(decision.decision, "stop");
});

Deno.test("d24-missing-evidence: a dry-run pilot is not a proceed measurement", () => {
  const decision = decide(input({ packages: [packageCost({ extent: "dry-run" })] }));
  assertEquals(decision.decision, "revise");
  assertEquals(decision.reasons.some((reason) => reason.includes("dry-run")), true);
  assertThrows(() => decide(input({ packages: [] })), Error, "packages");
});

Deno.test("phase214-ready: proceed needs the parent, team exception and CI approval", () => {
  const proceed = decide(input());
  assertEquals(
    readinessErrors({
      decision: proceed,
      parent_protected: true,
      team_exception: true,
      ci_approved: true,
      evidence: ["snapshot", "verdicts", "benchmarks", "cost"],
    }),
    [],
  );
  const missing = readinessErrors({
    decision: proceed,
    parent_protected: false,
    team_exception: false,
    ci_approved: false,
    evidence: [],
  });
  assertEquals(missing.length, 3);
});

Deno.test("phase245-real-run: the committed evidence is non-empty and the decision is recorded", async () => {
  const evidence = [
    "snapshot_run.json",
    "scenario_verdicts.json",
    "benchmarks.json",
    "cost_comparison.json",
    "d24_decision.json",
  ];
  for (const name of evidence) {
    const text = await Deno.readTextFile(
      new URL(`../../exaix-dev-docs/evidence/go-port/${name}`, import.meta.url),
    );
    assertEquals(text.length > 100, true);
  }
  const decision = JSON.parse(
    await Deno.readTextFile(new URL("../../exaix-dev-docs/evidence/go-port/d24_decision.json", import.meta.url)),
  ) as { decision: string; reasons: readonly string[] };
  assertStringIncludes("proceed,revise,stop", decision.decision);
  if (decision.decision !== "proceed") assertEquals(decision.reasons.length > 0, true);
});
