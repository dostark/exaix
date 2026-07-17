/**
 * @module TrajectorySourceStepResolutionTest
 * @path tests/scenario_framework/tests/unit/trajectory_source_step_resolution_test.ts
 * @description trajectory-assert steps declare `source_step: <id>` in YAML, but the runner
 * never resolved it into the `source_step_rowid_start`/`_end` fields step_executor.ts actually
 * reads — those silently defaulted to (0, 0) on every real (non-manual-fixture) run, making
 * trajectory-assert unreachable outside hand-authored journal-DB unit tests. Verifies
 * resolveTrajectorySourceStep (synthetic_runner.ts) fills those fields from the named step's
 * tracked rowid window, and leaves non-trajectory-assert steps / unresolved source_steps alone.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/tests/unit/trajectory_capture_test.ts]
 */

import { assertEquals } from "@std/assert";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";
import { resolveTrajectorySourceStep } from "../../runner/synthetic_runner.ts";

function trajectoryAssertStep(sourceStep: string): IScenarioStep {
  return {
    id: "assert-trajectory",
    type: ScenarioStepType.TRAJECTORY_ASSERT,
    source_step: sourceStep,
    expected_sequence: [{ tool: "read_file" }],
    order_matters: true,
    allow_extra_tools: false,
    partial_credit: false,
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
  };
}

function shellStep(id: string): IScenarioStep {
  return {
    id,
    type: ScenarioStepType.SHELL,
    command: "sh",
    args: ["-c", "true"],
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
  };
}

Deno.test("[TrajectorySourceStepResolution] fills rowid_start/end from the named source_step's tracked window", () => {
  const windows = new Map([["run-tool-calls", { start: 5, end: 12 }]]);
  const step = trajectoryAssertStep("run-tool-calls");

  const resolved = resolveTrajectorySourceStep(step, windows);

  assertEquals(resolved.source_step_rowid_start, 5);
  assertEquals(resolved.source_step_rowid_end, 12);
});

Deno.test("[TrajectorySourceStepResolution] non-trajectory-assert steps are returned unchanged", () => {
  const windows = new Map([["run-tool-calls", { start: 5, end: 12 }]]);
  const step = shellStep("run-tool-calls");

  const resolved = resolveTrajectorySourceStep(step, windows);

  assertEquals(resolved, step);
  assertEquals(resolved.source_step_rowid_start, undefined);
});

Deno.test("[TrajectorySourceStepResolution] unresolved source_step (not yet tracked) leaves the step unchanged", () => {
  const windows = new Map<string, { start: number; end: number }>();
  const step = trajectoryAssertStep("never-ran");

  const resolved = resolveTrajectorySourceStep(step, windows);

  assertEquals(resolved, step);
  assertEquals(resolved.source_step_rowid_start, undefined);
  assertEquals(resolved.source_step_rowid_end, undefined);
});

Deno.test("[TrajectorySourceStepResolution] scopes to the exact window of a repeated-id run (last-write-wins map semantics)", () => {
  const windows = new Map([["run-tool-calls", { start: 20, end: 25 }]]);
  const step = trajectoryAssertStep("run-tool-calls");

  const resolved = resolveTrajectorySourceStep(step, windows);

  // Confirms narrow scoping: the window is exactly the source step's own span, not from-run-start.
  assertEquals(resolved.source_step_rowid_start, 20);
  assertEquals(resolved.source_step_rowid_end, 25);
  assertEquals(resolved.source_step_rowid_start === 0, false);
});
