/**
 * @module ScenarioFrameworkScenarioCatalog
 * @path tests/scenario_framework/runner/scenario_catalog.ts
 * @description Implements Step 7 scenario-pack discovery and
 * selection for framework-owned scenario definitions and CI-safe subsets.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_loader.ts, tests/scenario_framework/tests/unit/agent_flows_pack_test.ts]
 */

import { walk } from "@std/fs";
import { relative, resolve } from "@std/path";
import type { IScenario } from "../schema/scenario_schema.ts";
import { ScenarioExecutionMode } from "../schema/step_schema.ts";
import { loadScenarioFromYamlFile } from "./scenario_loader.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface ILoadScenarioCatalogOptions {
  frameworkHome: string;
  scenariosDirectory?: string;
}

export interface IScenarioCatalogEntry extends IScenario {
  scenario_path: string;
  absolute_scenario_path: string;
}

export interface IScenarioCatalogSelectionOptions {
  catalog: IScenarioCatalogEntry[];
  scenarioIds?: string[];
  scenarioPaths?: string[];
  packs?: string[];
  tags?: string[];
}

const DEFAULT_SCENARIOS_DIRECTORY = "scenarios";
const SCENARIO_FILE_EXTENSIONS = [".yaml", ".yml"] as const;
export const CI_EXCLUDED_TAGS = ["manual-only", "provider-live", "live", "docker"] as const;

export async function loadScenarioCatalog(
  options: ILoadScenarioCatalogOptions,
): Promise<IScenarioCatalogEntry[]> {
  const frameworkHome = resolve(options.frameworkHome);
  const scenariosDirectory = resolve(
    frameworkHome,
    options.scenariosDirectory ?? DEFAULT_SCENARIOS_DIRECTORY,
  );
  const catalog: IScenarioCatalogEntry[] = [];

  for await (const entry of walk(scenariosDirectory, { includeDirs: false })) {
    if (!entry.isFile || !isScenarioFile(entry.path)) {
      continue;
    }

    const scenarioPath = relative(frameworkHome, entry.path);
    const loadedScenario = await loadScenarioFromYamlFile({
      frameworkHome,
      scenarioPath,
    });

    catalog.push({
      ...loadedScenario.scenario,
      scenario_path: scenarioPath,
      absolute_scenario_path: loadedScenario.absoluteScenarioPath,
    });
  }

  catalog.sort((left, right) => left.scenario_path.localeCompare(right.scenario_path));
  return catalog;
}

export function selectScenarioCatalogEntries(
  options: IScenarioCatalogSelectionOptions,
): IScenarioCatalogEntry[] {
  if ((options.scenarioIds?.length ?? 0) > 0) {
    return options.catalog.filter((scenario) => options.scenarioIds?.includes(scenario.id) ?? false);
  }

  if ((options.scenarioPaths?.length ?? 0) > 0) {
    return options.catalog.filter((scenario) => options.scenarioPaths?.includes(scenario.scenario_path) ?? false);
  }

  if ((options.packs?.length ?? 0) > 0) {
    return options.catalog.filter((scenario) => options.packs?.includes(scenario.pack) ?? false);
  }

  if ((options.tags?.length ?? 0) > 0) {
    return options.catalog.filter((scenario) => scenario.tags.some((tag) => options.tags?.includes(tag) ?? false));
  }

  return [...options.catalog];
}

export function listCiSafeScenarios(
  catalog: IScenarioCatalogEntry[],
  selection?: Opt<Omit<IScenarioCatalogSelectionOptions, "catalog">, Reason.QueryFilter>,
): IScenarioCatalogEntry[] {
  const selectedCatalog = selection === undefined ? catalog : selectScenarioCatalogEntries({
    catalog,
    ...selection,
  });

  return selectedCatalog.filter((scenario) => {
    if (!scenario.mode_support.includes(ScenarioExecutionMode.AUTO)) {
      return false;
    }

    return !scenario.tags.some((tag) => CI_EXCLUDED_TAGS.includes(tag as (typeof CI_EXCLUDED_TAGS)[number]));
  });
}

function isScenarioFile(path: string): boolean {
  return SCENARIO_FILE_EXTENSIONS.some((extension) => path.endsWith(extension));
}
