/**
 * @module GoPortScenarioBaselineTest
 * @path tests/scripts/go_port_scenario_baseline_test.ts
 * @description Validates the ci-smoke baseline schema, replay comparison and profile guard.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/scenario_baseline.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  assertProfile,
  catalogHashFor,
  compareBaselines,
  type IScenarioBaseline,
  missingVerdicts,
  normalizedRunHash,
  parseBaseline,
  replayPath,
  runnerCommand,
} from "../../scripts/go_port/scenario_baseline.ts";

function baseline(overrides: Partial<IScenarioBaseline> = {}): IScenarioBaseline {
  return {
    profile: "ci-smoke",
    catalog_hash: "abc",
    run_id: "run-1",
    started_at: "2026-11-19T00:00:00.000Z",
    verdicts: [
      { id: "framework-smoke-validation", verdict: "pass", evidence_hash: "h1" },
    ],
    ...overrides,
  };
}

Deno.test("scenario-baseline-schema: a missing verdict or evidence hash fails", () => {
  assertThrows(() => parseBaseline({ profile: "ci-smoke", verdicts: [] }), Error, "verdicts");
  assertThrows(
    () => parseBaseline({ profile: "ci-smoke", verdicts: [{ id: "x", verdict: "pass" }] }),
    Error,
    "evidence_hash",
  );
  assertEquals(parseBaseline(baseline()).verdicts.length, 1);
});

Deno.test("scenario-baseline-replay: verdict changes fail and metadata changes are ignored", () => {
  assertEquals(compareBaselines(baseline(), baseline()), []);
  const metadata = baseline({ run_id: "run-2", started_at: "2026-11-20T00:00:00.000Z" });
  assertEquals(compareBaselines(baseline(), metadata), []);
  const changed = baseline({ verdicts: [{ id: "framework-smoke-validation", verdict: "fail", evidence_hash: "h1" }] });
  assertEquals(compareBaselines(baseline(), changed).length > 0, true);
});

Deno.test("scenario-baseline-catalog: only ci-smoke and a non-empty set are accepted", () => {
  assertEquals(assertProfile("ci-smoke"), "ci-smoke");
  assertThrows(() => assertProfile("ci-core"), Error, "ci-smoke");
  assertThrows(() => parseBaseline(baseline({ verdicts: [] })), Error, "verdicts");
});

Deno.test("scenario-baseline-cli: the runner command binds the profile and snapshot env", () => {
  const command = runnerCommand("/snapshot", "/out");
  assertStringIncludes(command.args.join(" "), "--profile ci-smoke");
  assertEquals(command.env.EXA_BIN_PATH, "/snapshot/tests/scenario_framework/bin");
  assertEquals(command.env.EXA_DAEMON_SCRIPT, "/snapshot/apps/daemon/main.ts");
});

Deno.test("scenario-baseline-stable-hash: durations do not change the evidence hash", async () => {
  const first = {
    scenarioId: "framework-smoke-validation",
    outcome: "success",
    suite_score: 1,
    steps: [{ stepId: "execute-analysis", executionStatus: "passed", score: 1, durationMs: 10 }],
  };
  const second = {
    ...first,
    steps: [{ stepId: "execute-analysis", executionStatus: "passed", score: 1, durationMs: 9999 }],
  };
  assertEquals(await normalizedRunHash(first), await normalizedRunHash(second));
});

Deno.test("scenario-baseline-selected-catalog: only the selected scenarios are hashed", async () => {
  const selected = [{ id: "a", scenario_path: "scenarios/a.yaml" }];
  const manifest = {
    "tests/scenario_framework/scenarios/a.yaml": "hash-a",
    "tests/scenario_framework/scenarios/b.yaml": "hash-b",
  };
  const before = await catalogHashFor(selected, manifest);
  const after = await catalogHashFor(selected, { ...manifest, "tests/scenario_framework/scenarios/b.yaml": "changed" });
  assertEquals(before, after);
});

Deno.test("scenario-baseline-missing-scenario: a selected scenario without a verdict fails", () => {
  assertEquals(missingVerdicts(["a", "b"], [{ id: "a", verdict: "pass", evidence_hash: "h" }]), ["b"]);
  assertEquals(missingVerdicts(["a"], [{ id: "a", verdict: "pass", evidence_hash: "h" }]), []);
});

Deno.test("scenario-baseline-replay-cli: the replay path is parsed", () => {
  assertEquals(replayPath(["--replay=/tmp/b.json"]), "/tmp/b.json");
  assertEquals(replayPath([]), undefined);
});
