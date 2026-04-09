/**
 * @module SetupSandbox
 * @path scripts/setup_sandbox.ts
 * @description Automates the creation of a persistent Exaix validation sandbox,
 * following the workflow described in VALIDATION_GUIDE.md.
 */

import { Command } from "@cliffy/command";
import { join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";

async function run(
  cmd: string[],
  description: string,
  options: { env?: Record<string, string>; cwd?: string } = {},
): Promise<boolean> {
  console.log(`\n⏳ Running: ${description}...`);
  const status = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "inherit",
    stderr: "inherit",
    env: options.env,
    cwd: options.cwd,
  }).spawn().status;

  if (status.success) {
    console.log(`✅ Completed: ${description}`);
    return true;
  } else {
    console.error(`❌ Failed: ${description} (Exit code: ${status.code})`);
    return false;
  }
}

const setupCommand = new Command()
  .description("Setup a clean, persistent validation sandbox")
  .option("-d, --dir <path:string>", "Target sandbox directory", { required: true })
  .option("-p, --provider <provider:string>", "AI Provider to configure", { default: "mock" })
  .option("-m, --model <model:string>", "AI Model to configure", { default: "test" })
  .action(async (options) => {
    const sandboxRoot = resolve(options.dir);
    const workspaceDir = join(sandboxRoot, "workspace");
    const frameworkDir = join(sandboxRoot, "framework");
    const evidenceDir = join(sandboxRoot, "evidence");
    const binDir = join(sandboxRoot, "bin");

    console.log(`🚀 Setting up Exaix Sandbox at: ${sandboxRoot}`);

    // 1. Create structure
    await ensureDir(sandboxRoot);
    await ensureDir(workspaceDir);
    await ensureDir(evidenceDir);
    await ensureDir(binDir);

    const env = {
      ...Deno.env.toObject(),
      EXA_BIN_PATH: binDir,
      EXA_CONFIG_PATH: join(workspaceDir, "exa.config.toml"),
    };

    // 2. Deploy Workspace
    if (!await run(["bash", "./scripts/deploy_workspace.sh", workspaceDir], "Deploying Workspace", { env })) {
      Deno.exit(1);
    }

    // 3. Configure Provider
    const sampleConfigPath = join(workspaceDir, "exa.config.sample.toml");
    const configPath = join(workspaceDir, "exa.config.toml");

    try {
      // Proactively create exa.config.toml from sample if needed
      try {
        await Deno.stat(configPath);
      } catch {
        await Deno.copyFile(sampleConfigPath, configPath);
      }

      let config = await Deno.readTextFile(configPath);
      // Simple regex replacement for basic settings
      config = config.replace(/^provider\s*=\s*".*"/m, `provider = "${options.provider}"`);
      config = config.replace(/^model\s*=\s*".*"/m, `model = "${options.model}"`);

      if (options.provider === "mock") {
        if (!config.includes("[ai.mock]")) {
          config += '\n[ai.mock]\nstrategy = "pattern"\n';
        }
      }

      await Deno.writeTextFile(configPath, config);
      console.log(`✅ Configured provider: ${options.provider} (${options.model})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Could not update config: ${msg}. Please edit ${configPath} manually.`);
    }

    // 4. Initialize DB
    if (!await run(["deno", "run", "-A", "scripts/migrate_db.ts", "up"], "Initializing Database", { env })) {
      Deno.exit(1);
    }

    // 5. Mount current repo and dummy portals
    const exactl = join(binDir, "exactl");
    const samplePortalDir = join(sandboxRoot, "sample-app");
    await ensureDir(samplePortalDir);
    await ensureDir(join(samplePortalDir, ".git"));

    if (!await run([exactl, "portal", "add", Deno.cwd(), "portal-exaix"], "Mounting portal-exaix", { env })) {
      console.warn("⚠️  Failed to mount portal-exaix. Continuing anyway...");
    }

    if (
      !await run([exactl, "portal", "add", samplePortalDir, "portal-sample-app"], "Mounting portal-sample-app", { env })
    ) {
      console.warn("⚠️  Failed to mount portal-sample-app. Continuing anyway...");
    }

    // 6. Deploy Scenario Framework
    if (
      !await run([
        "deno",
        "run",
        "-A",
        "tests/scenario_framework/scripts/deploy_cli.ts",
        "--destination",
        frameworkDir,
        "--workspace",
        workspaceDir,
        "--output",
        evidenceDir,
      ], "Deploying Scenario Framework")
    ) {
      Deno.exit(1);
    }

    console.log(`\n🎉 Sandbox Setup Complete!`);
    console.log(`---------------------------------------------------------`);
    console.log(`To start using the sandbox, run:`);
    console.log(`  export PATH="${binDir}:$PATH"`);
    console.log(`  export EXA_CONFIG_PATH="${configPath}"`);
    console.log(``);
    console.log(`Start the daemon with:`);
    console.log(`  exactl daemon start`);
    console.log(``);
    console.log(`Execute scenarios with:`);
    console.log(`  cd ${join(frameworkDir, "scenario_framework")}`);
    console.log(`  ./bin/run-scenarios --profile ci-smoke --verbose`);
    console.log(`---------------------------------------------------------`);
  });

await setupCommand.parse(Deno.args);
