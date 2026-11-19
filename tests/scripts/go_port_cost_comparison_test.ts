/**
 * @module GoPortCostComparisonTest
 * @path tests/scripts/go_port_cost_comparison_test.ts
 * @description Validates the two-arm cost schema, conversion activity logs, hazards, selection and extrapolation.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/cost_comparison.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  type IActivityHours,
  type ICostComparison,
  type IPackageCost,
  validateCostComparison,
} from "../../scripts/go_port/cost_comparison.ts";

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
    spend_usd: 10,
    total: 6,
    hazards: [],
    construct_family: "utility",
    ...overrides,
  };
}

function costDoc(overrides: Partial<ICostComparison> = {}): ICostComparison {
  return {
    selection: { criteria: "small leaf", packages: ["packages/shared"] },
    packages: [
      packageCost({ arm: "converter-assisted" }),
      packageCost({ arm: "agent-only" }),
    ],
    extrapolation: { low: 100, high: 200, unit: "agent-hours", basis: "construct family" },
    ...overrides,
  };
}

Deno.test("cost-comparison-schema: a missing arm, activity, log or hazard fails", () => {
  assertEquals(validateCostComparison(costDoc()), []);
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], arm: "" as never }] })),
    Error,
    "arm",
  );
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], hours: {} as never }] })),
    Error,
    "hours",
  );
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], time_log: [] }] })),
    Error,
    "time_log",
  );
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], hazards: [1] as never }] })),
    Error,
    "hazards",
  );
});

Deno.test("cost-comparison-extrapolation: low above high or a bad total fails", () => {
  assertThrows(
    () => validateCostComparison(costDoc({ extrapolation: { low: 200, high: 100, unit: "agent-hours", basis: "x" } })),
    Error,
    "extrapolation",
  );
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], total: 0 }] })),
    Error,
    "total",
  );
});

Deno.test("cost-comparison-selection: an empty package list is refused", () => {
  assertThrows(
    () =>
      validateCostComparison(
        costDoc({ selection: { criteria: "x", packages: [] }, packages: [] }),
      ),
    Error,
    "selection.packages",
  );
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [{ ...costDoc().packages[0], construct_family: "" }] })),
    Error,
    "construct_family",
  );
});

Deno.test("cost-comparison-conversion: a conversion needs both arms and a complete log", () => {
  assertEquals(validateCostComparison(costDoc()), []);
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [packageCost()] })),
    Error,
    "arm",
  );
  const missingReview = packageCost({
    hours: { ...packageCost().hours, review: 0 },
  });
  assertThrows(
    () => validateCostComparison(costDoc({ packages: [packageCost({ arm: "converter-assisted" }), missingReview] })),
    Error,
    "hours.review",
  );
});

Deno.test("cost-comparison-real: the committed evidence keeps both dry-run arms", async () => {
  const evidence = await Deno.readTextFile(
    new URL("../../exaix-dev-docs/evidence/go-port/cost_comparison.json", import.meta.url),
  );
  assertStringIncludes(evidence, "converter-assisted");
  assertStringIncludes(evidence, "agent-only");
  assertStringIncludes(evidence, "dry-run");
  assertStringIncludes(evidence, "spend_usd");
  assertStringIncludes(evidence, "time_log");
});
