/**
 * @module ScenarioFrameworkDeployCli
 * @path tests/scenario_framework/scripts/deploy_cli.ts
 * @description CLI entry point for framework deployment.
 */

import { Command } from "@cliffy/command";
import { resolve } from "@std/path";
import { deployFrameworkToDirectory } from "./deploy_framework.ts";
import type { ScenarioExecutionMode } from "../schema/step_schema.ts";
import type { ScenarioCiProfile } from "../runner/config.ts";

const defaultSource = resolve(new URL(".", import.meta.url).pathname, "..");

await new Command()
  .name("deploy-framework")
  .version("0.1.0")
  .description("Deploy the scenario framework to an external directory")
  .option("-s, --source <path:string>", "Source framework root", {
    default: defaultSource,
  })
  .option("-d, --destination <path:string>", "Destination root directory", { required: true })
  .option("-w, --workspace <path:string>", "Target workspace path", { required: true })
  .option("-o, --output <path:string>", "Evidence output directory", { required: true })
  .option("-m, --mode <mode:string>", "Default execution mode", { default: "auto" })
  .option("-p, --profile <profile:string>", "Default CI profile")
  .action(async (options) => {
    const sourceFrameworkRoot = resolve(options.source);
    const destinationRoot = resolve(options.destination);

    console.log(`Deploying framework from ${sourceFrameworkRoot} to ${destinationRoot}...`);

    const result = await deployFrameworkToDirectory({
      sourceFrameworkRoot,
      destinationRoot,
      workspacePath: options.workspace,
      outputDir: options.output,
      cliFlags: {
        mode: options.mode as ScenarioExecutionMode,
        profile: options.profile as ScenarioCiProfile,
      },
    });

    console.log("Deployment successful.");
    console.log(`Destination framework root: ${result.destinationFrameworkRoot}`);
    console.log(`Runtime config created at: ${result.runtimeConfigPath}`);
  })
  .parse(Deno.args);
