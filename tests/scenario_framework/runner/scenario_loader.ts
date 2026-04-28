/**
 * @module ScenarioFrameworkScenarioLoader
 * @path tests/scenario_framework/runner/scenario_loader.ts
 * @description Loads scenario YAML files from the framework tree, validates
 * them against the scenario contracts, and resolves the referenced request
 * fixture content for execution.
 * @architectural-layer Test
 * * @related-files [tests/scenario_framework/runner/request_fixtures.ts, tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/tests/unit/scenario_loader_execution_core_test.ts]
 */

import { isAbsolute, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ensureScenarioUsesFixtureOnly, type IRequestFixture, loadRequestFixture } from "./request_fixtures.ts";
import type { IScenario } from "../schema/scenario_schema.ts";
import type { IScenarioStep } from "../schema/step_schema.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";

export interface IScenarioLoaderOptions {
  frameworkHome: string;
  scenarioPath: string;
}

export interface ILoadedScenario {
  scenario: IScenario;
  steps: IScenarioStep[];
  requestFixture: IRequestFixture;
  absoluteScenarioPath: string;
}

export async function loadScenarioFromYamlFile(
  options: IScenarioLoaderOptions,
): Promise<ILoadedScenario> {
  const frameworkHome = resolve(options.frameworkHome);

  if (isAbsolute(options.scenarioPath)) {
    throw new Error("scenario path must be framework-relative");
  }

  const absoluteScenarioPath = resolve(frameworkHome, options.scenarioPath);
  const allowedPrefix = `${frameworkHome}/`;
  if (absoluteScenarioPath !== frameworkHome && !absoluteScenarioPath.startsWith(allowedPrefix)) {
    throw new Error("scenario path escapes framework home");
  }

  const rawYaml = await Deno.readTextFile(absoluteScenarioPath);
  const parsedYaml = parseYaml(rawYaml) as unknown;
  const scenario = ensureScenarioUsesFixtureOnly(parsedYaml as JSONValue);
  const requestFixture = await loadRequestFixture({
    frameworkHome,
    requestFixturePath: scenario.request_fixture,
  });

  return {
    scenario,
    steps: [...scenario.steps],
    requestFixture,
    absoluteScenarioPath,
  };
}
