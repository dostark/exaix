/**
 * @module ScenarioFrameworkScenarioLoaderExecutionCoreTest
 * @path tests/scenario_framework/tests/unit/scenario_loader_execution_core_test.ts
 * @description RED-first tests for Step 3. Verifies YAML scenario
 * loading, runtime config parsing, and execution-core step handling before the
 * loader and executor implementations exist.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_loader.ts, tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/runner/config.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { loadRuntimeConfig } from "../../runner/config.ts";
import { loadScenarioFromYamlFile } from "../../runner/scenario_loader.ts";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import { withTempDir } from "@exaix/testing";

function createValidScenarioYaml(requestFixturePath: string): string {
  return [
    `schema_version: "${SCHEMA_VERSION}"`,
    'id: "step3-loader"',
    'title: "Scenario loader returns ordered validated steps"',
    'pack: "smoke"',
    'tags: ["smoke", "loader"]',
    `request_fixture: "${requestFixturePath}"`,
    'mode_support: ["auto"]',
    "portals: []",
    "steps:",
    '  - id: "first-step"',
    '    type: "shell"',
    '    command: "echo"',
    '    args: ["first"]',
    "    input_criteria: []",
    "    output_criteria: []",
    '  - id: "second-step"',
    '    type: "shell"',
    '    command: "echo"',
    '    args: ["second"]',
    "    input_criteria: []",
    "    output_criteria: []",
    "",
  ].join("\n");
}

async function withTempFrameworkHome(
  fn: (frameworkHome: string) => Promise<void>,
): Promise<void> {
  await withTempDir(async (frameworkHome) => {
    await fn(frameworkHome);
  }, { prefix: "scenario-framework-" });
}

async function setupFixtureFiles(
  frameworkHome: string,
  fixturePath: string,
  fixtureContent: string,
): Promise<void> {
  const fullPath = join(frameworkHome, fixturePath);
  await Deno.mkdir(join(frameworkHome, ...fixturePath.split("/").slice(0, -1)), { recursive: true });
  await Deno.writeTextFile(fullPath, fixtureContent);
}

Deno.test("[ScenarioFrameworkExecutionCore] scenario loader returns ordered validated steps for a valid scenario document", async () => {
  await withTempFrameworkHome(async (frameworkHome) => {
    const fixtureRelativePath = "fixtures/requests/shared/request.md";
    const scenarioRelativePath = "scenarios/smoke/loader.yaml";

    await setupFixtureFiles(frameworkHome, fixtureRelativePath, "# Request\n\nLoad me.\n");
    await setupFixtureFiles(frameworkHome, scenarioRelativePath, createValidScenarioYaml(fixtureRelativePath));

    const loadedScenario = await loadScenarioFromYamlFile({
      frameworkHome,
      scenarioPath: scenarioRelativePath,
    });

    assertEquals(loadedScenario.scenario.id, "step3-loader");
    assertEquals(loadedScenario.steps.map((step) => step.id), ["first-step", "second-step"]);
    assertStringIncludes(loadedScenario.requestFixture.content, "Load me");
  });
});

Deno.test("[ScenarioFrameworkExecutionCore] scenario loader rejects documents that violate schema contracts with a descriptive error", async () => {
  await withTempFrameworkHome(async (frameworkHome) => {
    const fixtureRelativePath = "fixtures/requests/shared/request.md";
    const scenarioRelativePath = "scenarios/smoke/invalid.yaml";

    await setupFixtureFiles(frameworkHome, fixtureRelativePath, "# Request\n\nLoad me.\n");
    await setupFixtureFiles(
      frameworkHome,
      scenarioRelativePath,
      [
        `schema_version: "${SCHEMA_VERSION}"`,
        'id: "invalid-scenario"',
        'pack: "smoke"',
        'tags: ["smoke"]',
        `request_fixture: "${fixtureRelativePath}"`,
        'mode_support: ["auto"]',
        "portals: []",
        "steps: []",
        "",
      ].join("\n"),
    );

    await assertRejects(
      async () => {
        await loadScenarioFromYamlFile({
          frameworkHome,
          scenarioPath: scenarioRelativePath,
        });
      },
      Error,
      "title",
    );
  });
});

Deno.test("[ScenarioFrameworkExecutionCore] shell step executor captures stdout and stderr independently", async () => {
  const executionResult = await executeScenarioStep({
    step: {
      id: "shell-step",
      type: ScenarioStepType.SHELL,
      command: Deno.execPath(),
      args: [
        "eval",
        'console.log("stdout-line"); console.error("stderr-line");',
      ],
      input_criteria: [],
      output_criteria: [],
      continue_on_failure: false,
    },
  });

  assertEquals(executionResult.exitCode, 0);
  assertStringIncludes(executionResult.stdout, "stdout-line");
  assertStringIncludes(executionResult.stderr, "stderr-line");
});

Deno.test("[ScenarioFrameworkExecutionCore] exactl steps execute and capture output through the configured executable", async () => {
  const executionResult = await executeScenarioStep({
    step: {
      id: "exactl-step",
      type: ScenarioStepType.EXACTL,
      command: "eval",
      args: [
        'console.log("exactl-line");',
      ],
      input_criteria: [],
      output_criteria: [],
      continue_on_failure: false,
    },
    exactlExecutable: Deno.execPath(),
  });

  assertEquals(executionResult.exitCode, 0);
  assertStringIncludes(executionResult.stdout, "exactl-line");
});

Deno.test("[ScenarioFrameworkExecutionCore] execution core records step start time, end time, exit code, and raw output", async () => {
  const executionResult = await executeScenarioStep({
    step: {
      id: "timed-step",
      type: ScenarioStepType.SHELL,
      command: Deno.execPath(),
      args: [
        "eval",
        'console.log("combined-output");',
      ],
      input_criteria: [],
      output_criteria: [],
      continue_on_failure: false,
    },
  });

  assert(executionResult.startedAt.length > 0);
  assert(executionResult.completedAt.length > 0);
  assert(executionResult.durationMs >= 0);
  assertEquals(executionResult.exitCode, 0);
  assertStringIncludes(executionResult.combinedOutput, "combined-output");
});

Deno.test("[ScenarioFrameworkExecutionCore] runtime config loader rejects unknown fields and missing required fields", () => {
  assertThrows(
    () => {
      loadRuntimeConfig({ mode: "auto" });
    },
    Error,
    "workspace_path",
  );

  assertThrows(
    () => {
      loadRuntimeConfig({
        workspace_path: "/tmp/workspace",
        output_dir: "/tmp/output",
        mode: "auto",
        unexpected: true,
      });
    },
    Error,
    "Unrecognized key",
  );
});

Deno.test("[ScenarioFrameworkExecutionCore] execution core logs the full command when verbose is enabled", async () => {
  const originalLog = console.log;
  let loggedMessage = "";
  console.log = (...args: string[]) => {
    loggedMessage += args.join(" ");
  };

  try {
    await executeScenarioStep({
      step: {
        id: "verbose-echo",
        type: ScenarioStepType.SHELL,
        command: "echo",
        args: ["verbose test"],
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      verbose: true,
    });

    assertStringIncludes(loggedMessage, "> echo verbose test");
  } finally {
    console.log = originalLog;
  }
});
