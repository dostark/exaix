/**
 * @module ScenarioFrameworkContentFixtures
 * @path tests/scenario_framework/runner/content_fixtures.ts
 * @description Loads a `write-file` content fixture from the scenario framework tree. A scenario
 *   keeps a config document in a file and names it, instead of embedding the document in YAML.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import { dirname, fromFileUrl, isAbsolute, resolve } from "@std/path";

/** The framework tree that a content fixture path is relative to. */
const FRAMEWORK_HOME = resolve(dirname(fromFileUrl(import.meta.url)), "..");

/** Reads a framework-relative content fixture. Rejects a path that escapes the framework tree. */
export async function loadContentFixture(relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) {
    throw new Error("content fixture path must be framework-relative");
  }
  const absolutePath = resolve(FRAMEWORK_HOME, relativePath);
  if (absolutePath !== FRAMEWORK_HOME && !absolutePath.startsWith(`${FRAMEWORK_HOME}/`)) {
    throw new Error("content fixture path escapes the framework home");
  }
  return await Deno.readTextFile(absolutePath);
}
