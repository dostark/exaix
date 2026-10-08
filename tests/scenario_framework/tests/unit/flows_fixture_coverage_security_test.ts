/**
 * @module FlowsFixtureCoverageSecurityTest
 * @path tests/scenario_framework/tests/unit/flows_fixture_coverage_security_test.ts
 * @description Verifies that incomplete or inconsistent recordings cannot satisfy the scenario manifest.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/expected_call_manifest.ts]
 */
import { assert } from "@std/assert";
import {
  type IExpectedCallManifest,
  JudgeVerdict,
  loadFlowFile,
  reconcileManifest,
} from "../helpers/expected_call_manifest.ts";
import { type IManifestCase, loadManifestCases } from "./helpers/flows_fixture_coverage_fixture.ts";

Deno.test("[flows_fixture_coverage] [security] omissions and extra fixtures cannot certify themselves", async () => {
  const cases = await loadManifestCases();
  const pick = (id: string) => {
    const found = cases.find(({ manifest }) => manifest.scenarioId === id);
    assert(found, `missing ${id} manifest`);
    return found;
  };
  const errorsFor = async (entry: IManifestCase, manifest: IExpectedCallManifest, recordings = entry.recordings) =>
    reconcileManifest(manifest, await loadFlowFile(entry.flowPath), recordings);

  const loop = pick("self-correcting-implementation");
  const oneJudge = {
    ...loop.manifest,
    calls: loop.manifest.calls.filter((call) => call.lane !== "quality-gate--judge" || call.callIndex === 0),
  };
  assert((await errorsFor(loop, oneJudge)).some((error) => error.includes("judge calls")));
  assert((await errorsFor(loop, oneJudge)).some((error) => error.includes("unexpected recording")));

  const flipped = {
    ...loop.manifest,
    calls: loop.manifest.calls.map((call) => call.verdict ? { ...call, verdict: JudgeVerdict.ABOVE } : call),
  };
  assert((await errorsFor(loop, flipped)).some((error) => error.includes("verdict")));

  const duplicate = [...loop.recordings, { ...loop.recordings[0], file: "copy.json" }];
  assert((await errorsFor(loop, loop.manifest, duplicate)).some((error) => error.includes("duplicate")));

  const branch = pick("branch-routing");
  const unchosen = { ...branch.manifest, selectedPath: [...branch.manifest.selectedPath, "feature"] };
  assert((await errorsFor(branch, unchosen)).some((error) => error.includes("selected step feature")));
  const reachedUnchosen = {
    ...branch.manifest,
    calls: [...branch.manifest.calls, { ...branch.manifest.calls[1], lane: "feature" }],
  };
  assert((await errorsFor(branch, reachedUnchosen)).some((error) => error.includes("unselected step feature")));

  const research = pick("parallel-research");
  const unmarkedFailure = {
    ...research.manifest,
    calls: research.manifest.calls.map((call) => ({ ...call, failure: undefined })),
  };
  assert((await errorsFor(research, unmarkedFailure)).some((error) => error.includes("unexpected recorded")));
  const inventedFailure = {
    ...research.manifest,
    calls: research.manifest.calls.map((call) => call.lane === "explore-docs" ? { ...call, failure: true } : call),
  };
  assert((await errorsFor(research, inventedFailure)).some((error) => error.includes("expected a recorded")));

  const team = pick("architecture-decision");
  const absentVoter = { ...team.manifest, calls: team.manifest.calls.filter((call) => call.lane !== "vote--voter-2") };
  assert((await errorsFor(team, absentVoter)).some((error) => error.includes("vote--voter-2")));
});
