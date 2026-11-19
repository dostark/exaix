/**
 * @module GoPortD24DecisionTest
 * @path tests/scripts/go_port_d24_decision_test.ts
 * @description Validates the D24 forecast rule, extrapolation, evidence integrity and the pipeline path.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/d24_decision.ts, scripts/go_port/cost_comparison.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  type IActivityHours,
  type ICostComparison,
  type IPackageCost,
  validateCostComparison,
} from "../../scripts/go_port/cost_comparison.ts";
import { decide, evidenceErrors, type ID24Input } from "../../scripts/go_port/d24_decision.ts";

const ACTIVITIES = [
  "tool_development",
  "ts_preparation",
  "review",
  "test_repair",
  "parity_debugging",
  "marker_resolution",
] as const;

function hours(value = 1): IActivityHours {
  return {
    tool_development: value,
    ts_preparation: value,
    review: value,
    test_repair: value,
    parity_debugging: value,
    marker_resolution: value,
  };
}

function activityLog() {
  return ACTIVITIES.map((activity) => ({
    activity,
    start: "2026-11-19T10:00:00.000Z",
    end: "2026-11-19T11:00:00.000Z",
  }));
}

function packageCost(overrides: Partial<IPackageCost> = {}): IPackageCost {
  return {
    package: "packages/shared",
    arm: "agent-only",
    extent: "conversion",
    hours: hours(),
    time_log: activityLog(),
    spend_usd: 5,
    total: 6,
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
    extrapolated_hours: 3,
    packages: [
      packageCost({ arm: "converter-assisted" }),
      packageCost({ arm: "agent-only" }),
    ],
    ...overrides,
  };
}

function conversionDoc(): ICostComparison {
  return {
    selection: { criteria: "small leaf", packages: ["packages/shared"] },
    packages: [
      {
        package: "packages/shared",
        arm: "converter-assisted",
        extent: "conversion",
        hours: hours(),
        time_log: activityLog(),
        spend_usd: 5,
        total: 6,
        hazards: [],
        construct_family: "utility",
      },
      {
        package: "packages/shared",
        arm: "agent-only",
        extent: "conversion",
        hours: hours(),
        time_log: activityLog(),
        spend_usd: 5,
        total: 6,
        hazards: [],
        construct_family: "utility",
      },
    ],
    extrapolation: { low: 100, high: 200, unit: "agent-hours", basis: "construct family" },
  };
}

Deno.test("d24-proceed: complete evidence under both extrapolated budgets proceeds", () => {
  const decision = decide(input());
  assertEquals(decision.decision, "proceed");
  assertEquals(decision.hours_multiple, 0.3);
  assertEquals(decision.spend_multiple, 0.5);
  assertEquals(decision.measured_hours, 12);
  assertEquals(decision.extrapolated_hours, 3);
});

Deno.test("d24-both-metrics: one over-budget metric forces revise", () => {
  const hoursOver = decide(input({ extrapolated_hours: 30 }));
  assertEquals(hoursOver.decision, "revise");
  const spendOver = decide(input({ measured_spend_usd: 250 }));
  assertEquals(spendOver.decision, "revise");
});

Deno.test("d24-stop: both metrics over budget stop the port", () => {
  const decision = decide(input({ extrapolated_hours: 30, measured_spend_usd: 250 }));
  assertEquals(decision.decision, "stop");
});

Deno.test("d24-missing-evidence: a dry-run pilot is not a forecast measurement", () => {
  const decision = decide(
    input({
      packages: [
        packageCost({ arm: "converter-assisted", extent: "dry-run" }),
        packageCost({ arm: "agent-only", extent: "dry-run" }),
      ],
    }),
  );
  assertEquals(decision.decision, "revise");
  assertEquals(decision.reasons.some((reason) => reason.includes("dry-run")), true);
  assertThrows(() => decide(input({ packages: [] })), Error, "packages");
});

Deno.test("d24-extrapolation: the forecast uses the extrapolated range, not raw pilot hours", () => {
  const decision = decide(input({ extrapolated_hours: 30 }));
  assertEquals(decision.measured_hours, 12);
  assertEquals(decision.hours_multiple, 3);
  assertEquals(decision.decision, "revise");
});

Deno.test("d24-pipeline-proceed: validated measured evidence can proceed", () => {
  const doc = conversionDoc();
  assertEquals(validateCostComparison(doc), []);
  const decision = decide({
    budget_hours: 160,
    budget_spend_usd: 100,
    measured_spend_usd: 10,
    extrapolated_hours: doc.extrapolation.high,
    packages: doc.packages,
    owner: "dostark",
  });
  assertEquals(decision.decision, "proceed");
});

Deno.test("d24-pipeline-stop: validated measured evidence can stop", () => {
  const doc = conversionDoc();
  assertEquals(validateCostComparison(doc), []);
  const decision = decide({
    budget_hours: 160,
    budget_spend_usd: 100,
    measured_spend_usd: 500,
    extrapolated_hours: 400,
    packages: doc.packages,
    owner: "dostark",
  });
  assertEquals(decision.hours_multiple, 2.5);
  assertEquals(decision.spend_multiple, 5);
  assertEquals(decision.decision, "stop");
});

Deno.test("d24-evidence-tamper: a missing or mismatched evidence reference fails", () => {
  const valid = {
    manifest_hash: "abc",
    snapshot_manifest_hash: "abc",
    verdict_count: 33,
    benchmark_modes: 6,
    cost_packages: 4,
  };
  assertEquals(evidenceErrors(valid), []);
  assertEquals(evidenceErrors({ ...valid, manifest_hash: "" }).length > 0, true);
  assertEquals(evidenceErrors({ ...valid, snapshot_manifest_hash: "other" }).length > 0, true);
  assertEquals(evidenceErrors({ ...valid, verdict_count: 0 }).length > 0, true);
  assertEquals(evidenceErrors({ ...valid, benchmark_modes: 0 }).length > 0, true);
  assertEquals(evidenceErrors({ ...valid, cost_packages: 0 }).length > 0, true);
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
