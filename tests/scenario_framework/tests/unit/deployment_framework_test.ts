/**
 * @module ScenarioFrameworkDeploymentFrameworkTest
 * @path tests/scenario_framework/tests/unit/deployment_framework_test.ts
 * @description RED-first tests for Step 6. Verifies deployable
 * framework planning, external runtime config resolution, non-Exaix portal
 * path handling, and deterministic deployment manifest writing before the
 * deployment module exists.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/deploy_framework.ts, tests/scenario_framework/runner/config.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { deployFrameworkToDirectory, planFrameworkDeployment } from "../../scripts/deploy_framework.ts";
import { planPortalMount, PortalLifecycleAction, resolveRuntimeConfigForExecution } from "../../runner/config.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";

async function setupDeploymentFiles(tempRoot: string) {
  const sourceFrameworkRoot = join(tempRoot, "repo/tests/scenario_framework");
  const destinationRoot = join(tempRoot, "external-tools");

  await Deno.mkdir(join(sourceFrameworkRoot, "runner"), { recursive: true });
  await Deno.mkdir(join(sourceFrameworkRoot, "fixtures/requests/shared"), {
    recursive: true,
  });
  await Deno.writeTextFile(join(sourceFrameworkRoot, "README.md"), "# Scenario Framework\n");
  await Deno.writeTextFile(join(sourceFrameworkRoot, "runner/config.ts"), "export const ok = true;\n");
  await Deno.writeTextFile(
    join(sourceFrameworkRoot, "fixtures/requests/shared/request.md"),
    "# Request\n",
  );
  return { sourceFrameworkRoot, destinationRoot };
}

Deno.test("[ScenarioFrameworkDeployment] deployment planner rewrites framework paths relative to the external destination correctly", async () => {
  const tempRoot = await Deno.makeTempDir({ prefix: "scenario-framework-deploy-" });

  try {
    const { sourceFrameworkRoot, destinationRoot } = await setupDeploymentFiles(tempRoot);

    const plan = await planFrameworkDeployment({
      sourceFrameworkRoot,
      destinationRoot,
      workspacePath: "/tmp/external-workspace",
      outputDir: "/tmp/external-output",
      portals: {
        "portal-sample-app": "/srv/repos/sample-app",
      },
    });

    assertEquals(plan.destinationFrameworkRoot, join(destinationRoot, "scenario_framework"));
    assertEquals(plan.runtimeConfigPath, join(destinationRoot, "scenario_framework/runtime_config.json"));
    assertEquals(plan.deploymentManifestPath, join(destinationRoot, "scenario_framework/deployment-manifest.json"));
    assertEquals(plan.copiedAssets, [
      "fixtures/requests/shared/request.md",
      "README.md",
      "runner/config.ts",
    ]);
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkDeployment] runtime config resolves explicit workspace, portal, and output paths without repo-root assumptions", () => {
  const runtimeConfig = resolveRuntimeConfigForExecution({
    executionDirectory: "/opt/tools/scenario_framework",
    fileConfig: {
      workspace_path: "/tmp/workspaces/exaix-under-test",
      output_dir: "/tmp/scenario-output",
      portals: {
        "portal-sample-app": "/srv/repos/sample-app",
      },
      mode: ScenarioExecutionMode.AUTO,
    },
  });

  assertEquals(runtimeConfig.framework_home, "/opt/tools/scenario_framework");
  assertEquals(runtimeConfig.workspace_path, "/tmp/workspaces/exaix-under-test");
  assertEquals(runtimeConfig.output_dir, "/tmp/scenario-output");
  assertEquals(runtimeConfig.portals?.["portal-sample-app"], "/srv/repos/sample-app");
});

Deno.test("[ScenarioFrameworkDeployment] portal mount preparation accepts non-Exaix repository paths", () => {
  const runtimeConfig = resolveRuntimeConfigForExecution({
    executionDirectory: "/opt/tools/scenario_framework",
    fileConfig: {
      workspace_path: "/tmp/workspaces/exaix-under-test",
      output_dir: "/tmp/scenario-output",
      portals: {
        "portal-sample-app": "/srv/repos/sample-app",
      },
    },
  });

  const plan = planPortalMount({
    alias: "portal-sample-app",
    desiredSourcePath: runtimeConfig.portals?.["portal-sample-app"] ?? "",
    allowDestructiveRemount: false,
  });

  assertEquals(plan.action, PortalLifecycleAction.CREATE_MISSING);
  assertEquals(plan.frameworkOwned, true);
});

Deno.test("[ScenarioFrameworkDeployment] deployment manifest records copied framework assets deterministically", async () => {
  const tempRoot = await Deno.makeTempDir({ prefix: "scenario-framework-deploy-" });

  try {
    const { sourceFrameworkRoot, destinationRoot } = await setupDeploymentFiles(tempRoot);

    const deployment = await deployFrameworkToDirectory({
      sourceFrameworkRoot,
      destinationRoot,
      workspacePath: "/tmp/external-workspace",
      outputDir: "/tmp/external-output",
      portals: {
        "portal-sample-app": "/srv/repos/sample-app",
      },
    });

    const manifestText = await Deno.readTextFile(deployment.deploymentManifestPath);
    assertStringIncludes(manifestText, '"copiedAssets": [');
    assertStringIncludes(manifestText, '"README.md"');
    assertStringIncludes(manifestText, '"fixtures/requests/shared/request.md"');
    assertStringIncludes(manifestText, '"runner/config.ts"');

    const runtimeConfigText = await Deno.readTextFile(deployment.runtimeConfigPath);
    assertStringIncludes(runtimeConfigText, '"framework_home":');
    assertStringIncludes(runtimeConfigText, '"workspace_path": "/tmp/external-workspace"');
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});
