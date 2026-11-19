/**
 * @module GoPortCostComparisonTest
 * @path tests/scripts/go_port_cost_comparison_test.ts
 * @description Validates the two-arm cost comparison schema, hazards, selection and extrapolation.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/cost_comparison.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { validateCostComparison } from "../../scripts/go_port/cost_comparison.ts";

Deno.test("cost-comparison-schema: a missing arm, activity or hazard fails", () => {
  const good = {
    selection: { criteria: "small leaf", packages: ["p"] },
    packages: [
      {
        package: "p",
        arm: "converter-assisted",
        extent: "dry-run",
        hours: {
          tool_development: 0,
          ts_preparation: 0.1,
          review: 0,
          test_repair: 0,
          parity_debugging: 0,
          marker_resolution: 0,
        },
        total: 0.1,
        hazards: [],
        construct_family: "utility",
      },
    ],
    extrapolation: { low: 0.1, high: 0.2, unit: "agent-hours", basis: "tool-only pilot" },
  };
  assertEquals(validateCostComparison(good), []);
  assertThrows(() => validateCostComparison({ ...good, packages: [{ ...good.packages[0], arm: "" }] }), Error, "arm");
  assertThrows(
    () => validateCostComparison({ ...good, packages: [{ ...good.packages[0], hours: {} }] }),
    Error,
    "hours",
  );
});

Deno.test("cost-comparison-extrapolation: low above high or a bad total fails", () => {
  const good = {
    selection: { criteria: "x", packages: ["p"] },
    packages: [{
      package: "p",
      arm: "agent-only",
      extent: "dry-run",
      hours: {
        tool_development: 0,
        ts_preparation: 0.1,
        review: 0,
        test_repair: 0,
        parity_debugging: 0,
        marker_resolution: 0,
      },
      total: 0.1,
      hazards: [],
      construct_family: "x",
    }],
    extrapolation: { low: 0.2, high: 0.1, unit: "agent-hours", basis: "x" },
  };
  assertThrows(() => validateCostComparison(good), Error, "extrapolation");
  assertThrows(
    () =>
      validateCostComparison({
        ...good,
        extrapolation: { ...good.extrapolation, low: 0.1, high: 0.2 },
        packages: [{ ...good.packages[0], total: 0 }],
      }),
    Error,
    "total",
  );
});

Deno.test("cost-comparison-hazards: an unresolved hazard must be named", () => {
  const good = {
    selection: { criteria: "x", packages: ["p"] },
    packages: [{
      package: "p",
      arm: "agent-only",
      extent: "dry-run",
      hours: {
        tool_development: 0,
        ts_preparation: 0.1,
        review: 0,
        test_repair: 0,
        parity_debugging: 0,
        marker_resolution: 0,
      },
      total: 0.1,
      hazards: ["unresolved"],
      construct_family: "x",
    }],
    extrapolation: { low: 0.1, high: 0.2, unit: "agent-hours", basis: "x" },
  };
  assertEquals(validateCostComparison(good), []);
  assertThrows(
    () => validateCostComparison({ ...good, packages: [{ ...good.packages[0], hazards: [1] as never }] }),
    Error,
    "hazards",
  );
});

Deno.test("cost-comparison-real: the committed evidence has both arms", async () => {
  const evidence = await Deno.readTextFile(
    new URL("../../exaix-dev-docs/evidence/go-port/cost_comparison.json", import.meta.url),
  );
  assertStringIncludes(evidence, "converter-assisted");
  assertStringIncludes(evidence, "agent-only");
  assertStringIncludes(evidence, "dry-run");
});

Deno.test("cost-comparison-selection: an empty package list is refused", () => {
  assertThrows(
    () =>
      validateCostComparison({
        selection: { criteria: "x", packages: [] },
        packages: [],
        extrapolation: { low: 0, high: 1, unit: "agent-hours", basis: "x" },
      }),
    Error,
    "selection.packages",
  );
});
