/**
 * @module ExaCtlScenarioSteps
 * @path tests/scenario_framework/tests/unit/helpers/exactl_scenario_steps.ts
 * @description Loads every exactl step of the scenario YAML files, so the scenario tests check the same steps.
 * @architectural-layer Test
 * @dependencies [@std/yaml, @std/fs]
 * @related-files [tests/scenario_framework/tests/unit/scenario_exactl_paths_test.ts, tests/scenario_framework/tests/unit/scenario_exactl_invocations_test.ts]
 */

import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import type { JSONValue } from "@exaix/core/types";

export interface IExaCtlStep {
  file: string;
  id: string;
  command: string;
  args: string[];
}

export const FRAMEWORK_HOME = fromFileUrl(new URL("../../../", import.meta.url));
const EXACTL_STEP_TYPE = "exactl";

function collectSteps(file: string, value: JSONValue, steps: IExaCtlStep[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSteps(file, item, steps);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (value.type === EXACTL_STEP_TYPE && typeof value.command === "string") {
    const args = Array.isArray(value.args) ? value.args.map(String) : [];
    steps.push({ file, id: String(value.id ?? ""), command: value.command, args });
  }
  for (const child of Object.values(value)) collectSteps(file, child, steps);
}

/** Every exactl step of every YAML file under the scenario framework. */
export async function loadExaCtlSteps(): Promise<IExaCtlStep[]> {
  const steps: IExaCtlStep[] = [];
  for await (const entry of walk(FRAMEWORK_HOME, { exts: [".yaml", ".yml"], includeDirs: false })) {
    collectSteps(entry.path, parse(await Deno.readTextFile(entry.path)) as JSONValue, steps);
  }
  return steps;
}
