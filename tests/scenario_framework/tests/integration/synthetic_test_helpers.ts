/**
 * @module SyntheticScenarioTestHelpers
 * @path tests/scenario_framework/tests/integration/synthetic_test_helpers.ts
 * @description Shared temp-environment and scenario fixture helpers for synthetic scenario integration tests.
 */

import { dirname, join } from "@std/path";

export interface ISyntheticTestEnv {
  frameworkHome: string;
  workspaceRoot: string;
  outputDir: string;
}

export interface ISyntheticScenarioStepDefinition {
  id: string;
  type: string;
  command: string;
  args: string[];
  checkpoint?: string;
  outputCriteriaLines: string[];
}

export interface IWriteSyntheticScenarioOptions {
  frameworkHome: string;
  scenarioId: string;
  tags: string[];
  steps: ISyntheticScenarioStepDefinition[];
  schemaVersion: string;
  requestFixturePath?: string;
  /** Scenario-level scoring mode (Phase 143 Step 3). Emitted as `scoring: "gated"`. */
  scoring?: "gated";
}

const DEFAULT_REQUEST_FIXTURE_PATH = "fixtures/requests/shared/synthetic_request.md";

export async function withSyntheticTestEnv(
  fn: (env: ISyntheticTestEnv) => Promise<void>,
): Promise<void> {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-workspace-" });
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-output-" });

  try {
    await fn({ frameworkHome, workspaceRoot, outputDir });
  } finally {
    await cleanupTempPaths([frameworkHome, workspaceRoot, outputDir]);
  }
}

export async function writeSyntheticScenario(
  options: IWriteSyntheticScenarioOptions,
): Promise<string> {
  const requestFixturePath = options.requestFixturePath ?? DEFAULT_REQUEST_FIXTURE_PATH;
  const scenarioPath = `scenarios/synthetic/${options.scenarioId}.yaml`;

  await Deno.mkdir(join(options.frameworkHome, dirname(requestFixturePath)), {
    recursive: true,
  });
  await Deno.mkdir(join(options.frameworkHome, "scenarios/synthetic"), { recursive: true });
  await Deno.writeTextFile(
    join(options.frameworkHome, requestFixturePath),
    "# Synthetic request\n\nRun the local synthetic scenario.\n",
  );
  await Deno.writeTextFile(
    join(options.frameworkHome, scenarioPath),
    [
      `schema_version: "${options.schemaVersion}"`,
      `id: "${options.scenarioId}"`,
      `title: "${options.scenarioId}"`,
      'pack: "synthetic"',
      `tags: [${options.tags.map((tag) => `"${tag}"`).join(", ")}]`,
      `request_fixture: "${requestFixturePath}"`,
      'mode_support: ["auto", "manual-checkpoint"]',
      "portals: []",
      ...(options.scoring ? [`scoring: "${options.scoring}"`] : []),
      "steps:",
      ...options.steps.flatMap((step) => [
        `  - id: "${step.id}"`,
        `    type: "${step.type}"`,
        `    command: "${escapeYaml(step.command)}"`,
        `    args: [${step.args.map((arg) => `"${escapeYaml(arg)}"`).join(", ")}]`,
        ...(step.checkpoint ? [`    checkpoint: "${step.checkpoint}"`] : []),
        "    input_criteria: []",
        "    output_criteria:",
        ...step.outputCriteriaLines,
      ]),
      "",
    ].join("\n"),
  );

  return scenarioPath;
}

export function escapeYaml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function cleanupTempPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    await Deno.remove(path, { recursive: true }).catch(() => {});
  }
}
