/**
 * @module ScenarioFrameworkFlowsFixtureCoverageTest
 * @path tests/scenario_framework/tests/unit/flows_fixture_coverage_test.ts
 * @description Phase 157 Step 3 — every AGENT step declared in the flow blueprint each
 *   default-selectable (solo-edition) flow_blueprints scenario drives has a committed
 *   fixture, so strict mode's miss-is-fatal guarantee cannot be satisfied by luck. Checks
 *   against the flow blueprint's own step list (not merely "some fixture exists for this
 *   scenario") because call sites are now addressed by flowStepId (Step 3 fix — the prior
 *   shared-counter scheme raced across parallel-wave steps and silently lost fixtures for
 *   colliding steps; see agent_runner.ts's callSiteCounterKey). A scenario whose flow
 *   changed (a step added, renamed, or a capture that raced and lost a step's fixture) would
 *   otherwise only be caught the next time someone actually runs the pack against
 *   mock+strict. Team-edition-gated scenarios are excluded — they
 *   are not part of the default solo-edition selection this pack's fixtures were captured
 *   against. Phase 205 scenarios opt into run-local recording lanes. Independent
 *   expected-call manifests cover them in both editions instead of this legacy check.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, packages/flow/src/flow_loader.ts, packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { dirname, fromFileUrl, join } from "@std/path";
import { type IScenarioCatalogEntry, loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { FlowLoader } from "@exaix/flow";
import {
  type IExpectedCallManifest,
  type IKeyedRecording,
  JudgeVerdict,
  loadFlowFile,
  loadKeyedRecordings,
  loadManifests,
  reconcileManifest,
  RECORDING_LANES_ENV,
} from "../helpers/expected_call_manifest.ts";

const TEST_FILE_DIR = dirname(fromFileUrl(import.meta.url));
const FRAMEWORK_HOME = join(TEST_FILE_DIR, "../..");
const REPO_ROOT = join(FRAMEWORK_HOME, "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "Blueprints", "Flows");
const FIXTURES_DIR = join(FRAMEWORK_HOME, "fixtures", "mock_recordings", "flow_blueprints");
const FLOW_BLUEPRINTS_PACK = "flow_blueprints";
const CALL_STEP_ID = "submit-flow-request";
const SOLO_EDITION = "solo";
const AGENT_STEP_TYPE = "agent";
const FIRST_CALL_INDEX = 0;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;

interface IScenarioFlow {
  scenarioId: string;
  flowId: string;
}

interface IRequestFrontmatter {
  flow?: string;
}

function optsIntoRecordingLanes(scenario: IScenarioCatalogEntry): boolean {
  return scenario.steps.some((step) => step.env?.[RECORDING_LANES_ENV] === "1");
}

async function requestFlowId(scenario: IScenarioCatalogEntry): Promise<string | undefined> {
  const raw = await Deno.readTextFile(join(FRAMEWORK_HOME, scenario.request_fixture));
  const match = raw.match(FRONTMATTER_PATTERN);
  assert(match, `${scenario.request_fixture} has no frontmatter block`);
  return (parseYaml(match[1]) as IRequestFrontmatter).flow;
}

async function loadSoloEditionFlowScenarios(): Promise<IScenarioFlow[]> {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const scenarios = catalog.filter((scenario) =>
    scenario.pack === FLOW_BLUEPRINTS_PACK && (!scenario.edition || scenario.edition === SOLO_EDITION) &&
    !optsIntoRecordingLanes(scenario)
  );

  const result: IScenarioFlow[] = [];
  for (const scenario of scenarios) {
    const requestPath = join(FRAMEWORK_HOME, scenario.request_fixture);
    const raw = await Deno.readTextFile(requestPath);
    const match = raw.match(FRONTMATTER_PATTERN);
    assert(match, `${scenario.request_fixture} has no frontmatter block`);
    const frontmatter = parseYaml(match[1]) as IRequestFrontmatter;
    if (!frontmatter.flow) continue;
    result.push({ scenarioId: scenario.id, flowId: frontmatter.flow });
  }
  return result;
}

async function agentStepIdsFor(flowId: string): Promise<string[]> {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow(flowId);
  return flow.steps
    .filter((step) => (step.type ?? AGENT_STEP_TYPE) === AGENT_STEP_TYPE)
    .map((step) => step.id);
}

async function listFixtureFilenames(): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const entry of Deno.readDir(FIXTURES_DIR)) {
    if (entry.isFile) names.add(entry.name);
  }
  return names;
}

function fixtureFilename(scenarioId: string, flowStepId: string): string {
  return `${scenarioId}__${CALL_STEP_ID}__${flowStepId}__${FIRST_CALL_INDEX}.json`;
}

Deno.test("[flows_fixture_coverage] every AGENT step in each solo-edition scenario's flow has a committed fixture", async () => {
  const scenarioFlows = await loadSoloEditionFlowScenarios();
  assert(scenarioFlows.length > 0, "expected at least one solo-edition flow_blueprints scenario in the catalog");

  const fixtureFilenames = await listFixtureFilenames();
  const missing: string[] = [];

  for (const { scenarioId, flowId } of scenarioFlows) {
    const agentStepIds = await agentStepIdsFor(flowId);
    assert(agentStepIds.length > 0, `flow ${flowId} declares no AGENT steps`);
    for (const flowStepId of agentStepIds) {
      if (!fixtureFilenames.has(fixtureFilename(scenarioId, flowStepId))) {
        missing.push(`${scenarioId}/${flowStepId} (flow: ${flowId})`);
      }
    }
  }

  assert(
    missing.length === 0,
    `flow steps missing a committed fixture (strict mode would fail these outright): ${missing.join(", ")}`,
  );
});

interface IManifestCase {
  manifest: IExpectedCallManifest;
  scenario: IScenarioCatalogEntry;
  flowPath: string;
  recordings: IKeyedRecording[];
}

async function loadManifestCases(): Promise<IManifestCase[]> {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const cases: IManifestCase[] = [];
  for (const manifest of await loadManifests(FRAMEWORK_HOME)) {
    const scenario = catalog.find((entry) => entry.id === manifest.scenarioId);
    assert(scenario, `manifest ${manifest.scenarioId} names no catalog scenario`);
    const flowPath = scenario.flow_fixture
      ? join(FRAMEWORK_HOME, scenario.flow_fixture)
      : join(FLOWS_DIR, `${await requestFlowId(scenario)}.flow.yaml`);
    const recordings = await loadKeyedRecordings(join(FRAMEWORK_HOME, manifest.fixtureDir));
    cases.push({ manifest, scenario, flowPath, recordings });
  }
  return cases;
}

Deno.test("[flows_fixture_coverage] every opted-in scenario has an independent expected-call manifest", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const optedIn = catalog.filter(optsIntoRecordingLanes).map((scenario) => scenario.id).sort();
  const manifests = (await loadManifests(FRAMEWORK_HOME)).map((manifest) => manifest.scenarioId);
  assertEquals(manifests, optedIn);
  assert(optedIn.includes("self-correcting-implementation"));
});

Deno.test("[flows_fixture_coverage] manifests reconcile with schema-valid flows, editions and keyed recordings", async () => {
  const cases = await loadManifestCases();
  const editions = new Set(cases.map(({ manifest }) => manifest.edition));
  assert(editions.has("solo") && editions.has("team"), "manifests must cover Solo and Team cases");
  for (const { manifest, scenario, flowPath, recordings } of cases) {
    assertEquals(manifest.edition, scenario.edition ?? SOLO_EDITION, `${manifest.scenarioId} edition`);
    const errors = reconcileManifest(manifest, await loadFlowFile(flowPath), recordings);
    assertEquals(errors, [], `${manifest.scenarioId} manifest discrepancies`);
  }
});

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

  const team = pick("architecture-decision");
  const absentVoter = { ...team.manifest, calls: team.manifest.calls.filter((call) => call.lane !== "vote--voter-2") };
  assert((await errorsFor(team, absentVoter)).some((error) => error.includes("vote--voter-2")));
});
