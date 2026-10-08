/**
 * @module FlowsFixtureCoverageFixture
 * @path tests/scenario_framework/tests/unit/helpers/flows_fixture_coverage_fixture.ts
 * @description Loads scenario manifests and recordings for coverage and security tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/expected_call_manifest.ts]
 */
import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type IScenarioCatalogEntry, loadScenarioCatalog } from "../../../runner/scenario_catalog.ts";
import {
  type IExpectedCallManifest,
  type IKeyedRecording,
  loadKeyedRecordings,
  loadManifests,
} from "../../helpers/expected_call_manifest.ts";

export interface IManifestCase {
  manifest: IExpectedCallManifest;
  scenario: IScenarioCatalogEntry;
  flowPath: string;
  recordings: IKeyedRecording[];
}

const FRAMEWORK_HOME = fromFileUrl(new URL("../../../", import.meta.url));
const FLOWS_DIR = join(FRAMEWORK_HOME, "..", "..", "Blueprints", "Flows");
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;
interface IRequestFrontmatter {
  flow?: string;
}

async function requestFlowId(scenario: IScenarioCatalogEntry): Promise<string | undefined> {
  const raw = await Deno.readTextFile(join(FRAMEWORK_HOME, scenario.request_fixture));
  const match = raw.match(FRONTMATTER_PATTERN);
  assert(match, `${scenario.request_fixture} has no frontmatter block`);
  return (parseYaml(match[1]) as IRequestFrontmatter).flow;
}

export async function loadManifestCases(): Promise<IManifestCase[]> {
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
