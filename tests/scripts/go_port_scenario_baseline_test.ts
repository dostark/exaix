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
  compareBaselines,
  type IScenarioBaseline,
  parseBaseline,
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
