/**
 * @module DynamicIdentityRoutingSyntheticScenarioTest
 * @path tests/scenario_framework/tests/integration/dynamic_identity_routing_synthetic_test.ts
 * @description Verifies the Scenario Framework can execute a synthetic scenario that exercises
 * Phase 74 dynamic identity routing and validates the routing outcome end to end.
 */

import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";

const SCENARIO_ID = "dynamic-identity-routing";
const SCRIPT_TEMPLATE_NAME = "dynamic_identity_routing.ts.template";
const GENERATED_SCRIPT_NAME = "dynamic_identity_routing.ts";
const BLUEPRINTS_SUBDIR = "Blueprints/Identities";
const ROUTING_POLICY_FILE_NAME = ".exa/routing.policy.yaml";
const REQUEST_FIXTURE_PATH = "fixtures/requests/shared/synthetic_request.md";
const RESULT_FILE_PATH = "artifacts/result.json";
const SELECTED_IDENTITY = "senior-coder";
const DEFAULT_AGENT_ID = "default-agent";
const DYNAMIC_ROUTING_STEP_ID = "execute-dynamic-routing";
const SCENARIO_TAGS = ["routing", "dynamic"] as const;
const FIXTURE_ROOT =
  new URL("../../../../tests/scenario_framework/fixtures/dynamic_identity_routing/", import.meta.url).pathname;
const REPO_ROOT_FILE_URL = new URL("../../../../", import.meta.url).href;
const DENO_CONFIG_FILE = new URL("../../../../deno.json", import.meta.url).pathname;
const REPO_ROOT_PLACEHOLDER = "{{REPO_ROOT}}";

interface ISyntheticTestEnv {
  frameworkHome: string;
  workspaceRoot: string;
  outputDir: string;
}

async function withSyntheticTestEnv(
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

Deno.test(
  "[ScenarioFrameworkSyntheticRunner] dynamic identity routing scenario executes successfully",
  async () => {
    await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
      const scriptPath = await prepareWorkspaceFixtures(workspaceRoot);
      const scenarioPath = await writeSyntheticScenario({
        frameworkHome,
        scenarioId: SCENARIO_ID,
        tags: Array.from(SCENARIO_TAGS),
        steps: [
          {
            id: DYNAMIC_ROUTING_STEP_ID,
            type: ScenarioStepType.SHELL,
            command: Deno.execPath(),
            args: ["run", "--config", DENO_CONFIG_FILE, "--no-check", "--allow-all", scriptPath],
            outputCriteriaLines: [
              `    - id: "${SELECTED_IDENTITY}-file-created"`,
              `      kind: "file-exists"`,
              `      path: "${RESULT_FILE_PATH}"`,
              `    - id: "selected-identity-${SELECTED_IDENTITY}"`,
              `      kind: "json-path-equals"`,
              `      path: "$.selected_identity_id"`,
              `      equals: "${SELECTED_IDENTITY}"`,
              `      target_file: "${RESULT_FILE_PATH}"`,
            ],
          },
        ],
      });

      const run = await runSyntheticScenario({
        frameworkHome,
        scenarioPath,
        workspaceRoot,
        outputDir,
        mode: ScenarioExecutionMode.AUTO,
      });

      assertEquals(run.runResult.status, "completed");
      assertEquals(run.manifest.outcome, "success");
      assertEquals(run.manifest.steps[0].executionStatus, "passed");
    });
  },
);

async function prepareWorkspaceFixtures(workspaceRoot: string): Promise<string> {
  await copyFixture(
    join(FIXTURE_ROOT, "blueprints", `${SELECTED_IDENTITY}.md`),
    join(workspaceRoot, BLUEPRINTS_SUBDIR, `${SELECTED_IDENTITY}.md`),
  );
  await copyFixture(
    join(FIXTURE_ROOT, "blueprints", `${DEFAULT_AGENT_ID}.md`),
    join(workspaceRoot, BLUEPRINTS_SUBDIR, `${DEFAULT_AGENT_ID}.md`),
  );
  await Deno.mkdir(join(workspaceRoot, ".exa"), { recursive: true });
  await copyFixture(
    join(FIXTURE_ROOT, "routing.policy.yaml"),
    join(workspaceRoot, ROUTING_POLICY_FILE_NAME),
  );

  return await writeDynamicRoutingScript(workspaceRoot);
}

async function writeDynamicRoutingScript(workspaceRoot: string): Promise<string> {
  const scriptTemplate = await Deno.readTextFile(join(FIXTURE_ROOT, SCRIPT_TEMPLATE_NAME));
  const scriptContent = scriptTemplate.replaceAll(REPO_ROOT_PLACEHOLDER, REPO_ROOT_FILE_URL);
  const scriptPath = join(workspaceRoot, GENERATED_SCRIPT_NAME);
  await Deno.writeTextFile(scriptPath, scriptContent);
  return scriptPath;
}

async function copyFixture(sourcePath: string, destinationPath: string): Promise<void> {
  const contents = await Deno.readTextFile(sourcePath);
  await Deno.mkdir(dirname(destinationPath), { recursive: true });
  await Deno.writeTextFile(destinationPath, contents);
}

interface ISyntheticScenarioStepDefinition {
  id: string;
  type: ScenarioStepType;
  command: string;
  args: string[];
  outputCriteriaLines: string[];
}

interface IWriteSyntheticScenarioOptions {
  frameworkHome: string;
  scenarioId: string;
  tags: string[];
  steps: ISyntheticScenarioStepDefinition[];
}

async function writeSyntheticScenario(options: IWriteSyntheticScenarioOptions): Promise<string> {
  const scenarioPath = `scenarios/synthetic/${options.scenarioId}.yaml`;

  await Deno.mkdir(join(options.frameworkHome, dirname(REQUEST_FIXTURE_PATH)), {
    recursive: true,
  });
  await Deno.mkdir(join(options.frameworkHome, "scenarios/synthetic"), { recursive: true });
  await Deno.writeTextFile(
    join(options.frameworkHome, REQUEST_FIXTURE_PATH),
    "# Synthetic request\n\nRun the local synthetic scenario.\n",
  );
  await Deno.writeTextFile(
    join(options.frameworkHome, scenarioPath),
    [
      `schema_version: "${SCHEMA_VERSION}"`,
      `id: "${options.scenarioId}"`,
      `title: "${options.scenarioId}"`,
      'pack: "synthetic"',
      `tags: [${options.tags.map((tag) => `"${tag}"`).join(", ")}]`,
      `request_fixture: "${REQUEST_FIXTURE_PATH}"`,
      'mode_support: ["auto", "manual-checkpoint"]',
      "portals: []",
      "steps:",
      ...options.steps.flatMap((step) => [
        `  - id: "${step.id}"`,
        `    type: "${step.type}"`,
        `    command: "${escapeYaml(step.command)}"`,
        `    args: [${step.args.map((arg) => `"${escapeYaml(arg)}"`).join(", ")}]`,
        "    input_criteria: []",
        "    output_criteria:",
        ...step.outputCriteriaLines,
      ]),
      "",
    ].join("\n"),
  );

  return scenarioPath;
}

function escapeYaml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function cleanupTempPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    await Deno.remove(path, { recursive: true }).catch(() => {});
  }
}
