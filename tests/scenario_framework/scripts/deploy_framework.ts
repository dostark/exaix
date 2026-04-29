/**
 * @module ScenarioFrameworkDeployFramework
 * @path tests/scenario_framework/scripts/deploy_framework.ts
 * @description Implements Step 6 framework deployment planning and
 * copying so the scenario framework can run from an external destination with
 * rewritten runtime configuration.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/tests/unit/deployment_framework_test.ts]
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative, resolve } from "@std/path";
import {
  type IRuntimeConfig,
  type IScenarioRunnerCliFlags,
  resolveRuntimeConfigForExecution,
} from "../runner/config.ts";

export interface IFrameworkDeploymentOptions {
  sourceFrameworkRoot: string;
  destinationRoot: string;
  workspacePath: string;
  outputDir: string;
  portals?: { [key: string]: string };
  cliFlags?: IScenarioRunnerCliFlags;
}

export interface IFrameworkDeploymentPlan {
  sourceFrameworkRoot: string;
  destinationFrameworkRoot: string;
  runtimeConfigPath: string;
  deploymentManifestPath: string;
  copiedAssets: string[];
  resolvedRuntimeConfig: IRuntimeConfig;
}

export interface IFrameworkDeploymentResult extends IFrameworkDeploymentPlan {}

export interface IDeploymentManifest {
  sourceFrameworkRoot: string;
  destinationFrameworkRoot: string;
  runtimeConfigPath: string;
  copiedAssets: string[];
}

const DEPLOYED_FRAMEWORK_DIR = "scenario_framework";
const RUNTIME_CONFIG_FILE = "runtime_config.json";
const DEPLOYMENT_MANIFEST_FILE = "deployment-manifest.json";

export async function planFrameworkDeployment(
  options: IFrameworkDeploymentOptions,
): Promise<IFrameworkDeploymentPlan> {
  const sourceFrameworkRoot = resolve(options.sourceFrameworkRoot);
  const destinationFrameworkRoot = resolve(options.destinationRoot, DEPLOYED_FRAMEWORK_DIR);
  const copiedAssets = await collectFrameworkFiles(sourceFrameworkRoot);
  const runtimeConfigPath = join(destinationFrameworkRoot, RUNTIME_CONFIG_FILE);
  const deploymentManifestPath = join(destinationFrameworkRoot, DEPLOYMENT_MANIFEST_FILE);
  const resolvedRuntimeConfig = resolveRuntimeConfigForExecution({
    executionDirectory: destinationFrameworkRoot,
    fileConfig: {
      workspace_path: options.workspacePath,
      output_dir: options.outputDir,
      portals: options.portals,
    },
    cliFlags: options.cliFlags,
  });

  return {
    sourceFrameworkRoot,
    destinationFrameworkRoot,
    runtimeConfigPath,
    deploymentManifestPath,
    copiedAssets,
    resolvedRuntimeConfig,
  };
}

export async function deployFrameworkToDirectory(
  options: IFrameworkDeploymentOptions,
): Promise<IFrameworkDeploymentResult> {
  const plan = await planFrameworkDeployment(options);
  await ensureDir(plan.destinationFrameworkRoot);

  for (const assetPath of plan.copiedAssets) {
    const sourcePath = join(plan.sourceFrameworkRoot, assetPath);
    const destinationPath = join(plan.destinationFrameworkRoot, assetPath);
    await ensureDir(dirname(destinationPath));
    await Deno.copyFile(sourcePath, destinationPath);
  }

  // Copy deno.json from the repository root to allow dependencies to resolve in the deployed framework.
  const rootDenoConfig = join(plan.sourceFrameworkRoot, "../../deno.json");
  const destinationDenoConfig = join(plan.destinationFrameworkRoot, "deno.json");
  try {
    await Deno.copyFile(rootDenoConfig, destinationDenoConfig);
    plan.copiedAssets.push("deno.json");
  } catch (error) {
    console.warn(`Warning: Could not copy root deno.json to ${destinationDenoConfig}:`, (error as Error).message);
  }

  await Deno.writeTextFile(
    plan.runtimeConfigPath,
    `${JSON.stringify(plan.resolvedRuntimeConfig, null, 2)}\n`,
  );

  const deploymentManifest: IDeploymentManifest = {
    sourceFrameworkRoot: plan.sourceFrameworkRoot,
    destinationFrameworkRoot: plan.destinationFrameworkRoot,
    runtimeConfigPath: plan.runtimeConfigPath,
    copiedAssets: [...plan.copiedAssets],
  };

  await Deno.writeTextFile(
    plan.deploymentManifestPath,
    `${JSON.stringify(deploymentManifest, null, 2)}\n`,
  );

  return plan;
}

async function collectFrameworkFiles(sourceFrameworkRoot: string): Promise<string[]> {
  const copiedAssets: string[] = [];

  for await (const entry of walk(sourceFrameworkRoot, { includeDirs: false })) {
    if (!entry.isFile) {
      continue;
    }

    copiedAssets.push(relative(sourceFrameworkRoot, entry.path));
  }

  copiedAssets.sort((left, right) => left.localeCompare(right));
  return copiedAssets;
}
