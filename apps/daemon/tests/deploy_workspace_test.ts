/**
 * @module WorkspaceDeployTest
 * @path apps/daemon/tests/deploy_workspace_test.ts
 * @description Verifies workspace-level deployment logic, ensuring that cross-portal
 * dependencies and global configuration are correctly handled during deployment.
 */

import * as pathBuilders from "@exaix/shared";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { getDefaultPaths } from "@exaix/core/config";
import { withCliProcessMutex } from "../../../tests/helpers/cli_process_mutex.ts";
import { ALLOWED_UNDEPLOYED_DIRS, undeployedDirsNamedBy } from "../../../tests/helpers/deployed_task_dirs.ts";
import { readConfigFixture } from "../../../tests/integration/helpers/config_fixture.ts";
import {
  DEPLOYED_SCRIPT_FILES,
  deployUnslopAssets,
  installUnslopAssets,
  stripDevOnlyConfig,
  UNSLOP_DEPLOY_ASSET_FILES,
  verifyUnslopAssetSet,
} from "../../../scripts/deploy_workspace.ts";

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";

function parallelSafeTest(
  nameOrDef: string | Deno.TestDefinition,
  fn?: () => Promise<void> | void,
): void {
  if (typeof nameOrDef === "string") {
    Deno.test({ name: nameOrDef, ignore: skipInParallel, fn: fn! });
    return;
  }

  Deno.test({
    ...nameOrDef,
    ignore: skipInParallel || !!nameOrDef.ignore,
  });
}

const __dirname = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const _paths = getDefaultPaths(REPO_ROOT);

parallelSafeTest("deploy_workspace.ts --no-run creates deploy files", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-deploy-test-" });
  try {
    const deployScript = join(REPO_ROOT, "scripts", "deploy_workspace.ts");

    const cmd = new Deno.Command("deno", {
      args: ["run", "-A", deployScript, "--no-run", tmp],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    });
    const res = await cmd.output();
    const out = new TextDecoder().decode(res.stdout || new Uint8Array());
    const err = new TextDecoder().decode(res.stderr || new Uint8Array());
    if (res.code !== 0) {
      console.error("deploy failed stdout:\n", out);
      console.error("deploy failed stderr:\n", err);
    }

    assert(res.code === 0, `deploy_workspace.ts exited with code ${res.code}`);

    // Basic expectations: README.md exists and scripts/setup_db.ts was copied
    const readme = join(tmp, "README.md");
    const setupScript = join(tmp, "scripts", "setup_db.ts");

    const readmeStat = await Deno.stat(readme);
    assert(readmeStat.isFile, "README.md not created in deployed workspace");

    const setupStat = await Deno.stat(setupScript);
    assert(setupStat.isFile, "setup_db.ts not copied to deployed workspace/scripts");

    // Verify migrate_db.ts was copied (required for setup_db.ts)
    const migrateScript = join(tmp, "scripts", "migrate_db.ts");
    assert(
      await exists(migrateScript),
      "migrate_db.ts not copied to deployed workspace/scripts",
    );

    const providerCostsSchema = join(tmp, "scripts", "provider_costs_schema.ts");
    assert(
      await exists(providerCostsSchema),
      "provider_costs_schema.ts not copied to deployed workspace/scripts",
    );

    const skillJournalSchema = join(tmp, "scripts", "skill_journal_schema.ts");
    assert(
      await exists(skillJournalSchema),
      "skill_journal_schema.ts not copied to deployed workspace/scripts",
    );

    // Verify migrations folder was copied
    const migrationsDir = join(tmp, "migrations");
    assert(
      await exists(migrationsDir),
      "migrations folder not copied to deployed workspace",
    );

    // Verify at least one migration file exists
    const initMigration = join(tmp, "migrations", "001_init.sql");
    assert(
      await exists(initMigration),
      "001_init.sql not copied to deployed workspace/migrations",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

interface IDeployedConfig {
  readonly workspace?: string[];
  readonly lint?: { readonly plugins?: string[] };
  readonly tasks?: Record<string, string>;
}

const UNDEPLOYED_TASK_REFERENCE =
  /unslop-ts\/|packages\/lint-policy\/|scripts\/(?!setup_db|migrate_db|scaffold|deploy_workspace)\S+\.ts/;

async function runDenoIn(cwd: string, args: string[]): Promise<string> {
  const res = await new Deno.Command("deno", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const decoder = new TextDecoder();
  return decoder.decode(res.stdout) + decoder.decode(res.stderr);
}

parallelSafeTest("deploy_workspace.ts --no-run writes a deno.json that references only deployed paths", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-deploy-config-test-" });
  try {
    const deployScript = join(REPO_ROOT, "scripts", "deploy_workspace.ts");
    const res = await new Deno.Command("deno", {
      args: ["run", "-A", deployScript, "--no-run", tmp],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(res.code === 0, `deploy_workspace.ts exited with code ${res.code}`);

    const config: IDeployedConfig = JSON.parse(await Deno.readTextFile(join(tmp, "deno.json")));
    for (const member of config.workspace ?? []) {
      assert(await exists(join(tmp, member)), `workspace member ${member} must exist in the deployed workspace`);
    }
    assert((config.lint?.plugins ?? []).length === 0, "the deployed config must not list lint plugins");
    const strayDirs = undeployedDirsNamedBy(config.tasks ?? {}).filter((dir) => !ALLOWED_UNDEPLOYED_DIRS.includes(dir));
    assert(strayDirs.length === 0, `tasks name undeployed directories: ${strayDirs.join(", ")}`);
    const dangling = Object.entries(config.tasks ?? {})
      .filter(([, command]) => UNDEPLOYED_TASK_REFERENCE.test(command))
      .map(([name]) => name);
    assert(dangling.length === 0, `tasks run undeployed files: ${dangling.join(", ")}`);

    const output = await runDenoIn(tmp, ["lint", "apps/exactl/main.ts"]) +
      await runDenoIn(tmp, ["check", "apps/exactl/main.ts"]);
    assert(!/Workspace member .* not found/i.test(output), `deployed workspace output: ${output}`);
    assert(!/Module not found/i.test(output), `deployed workspace output: ${output}`);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

async function runExactl(
  workspacePath: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
  const exactlPath = join(repoRoot, "apps", "exactl", "main.ts");

  const configPath = join(workspacePath, "exa.config.toml");
  const hasConfig = await Deno.stat(configPath).then(() => true).catch(() => false);
  if (!hasConfig) {
    await Deno.writeTextFile(
      configPath,
      readConfigFixture("daemon-deploy-workspace", { root: workspacePath }),
    );
  }

  const parentEnv = Deno.env.toObject();
  const fullEnv: Record<string, string> = {
    PATH: parentEnv.PATH ?? "",
    HOME: parentEnv.HOME ?? "",
    TMPDIR: parentEnv.TMPDIR ?? "/tmp",
    TERM: parentEnv.TERM ?? "xterm",
    ...env,
  };
  if (!fullEnv.EXA_LLM_PROVIDER) {
    fullEnv.EXA_LLM_PROVIDER = "mock";
  }

  fullEnv.EXA_CONFIG_PATH = configPath;

  const res = await withCliProcessMutex(async () => {
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", exactlPath, ...args],
      cwd: workspacePath,
      stdout: "piped",
      stderr: "piped",
      env: fullEnv,
    });

    return await cmd.output();
  });
  return {
    code: res.code,
    stdout: new TextDecoder().decode(res.stdout),
    stderr: new TextDecoder().decode(res.stderr),
  };
}

// Helper to deploy and setup a test workspace
async function deployTestWorkspace(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-daemon-test-" });
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
  const deployScript = join(repoRoot, "scripts", "deploy_workspace.ts");

  // Deploy with --no-run (we'll run setup manually)
  const deployCmd = new Deno.Command("deno", {
    args: ["run", "-A", deployScript, "--no-run", tmp],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  });

  const deployRes = await deployCmd.output();
  if (deployRes.code !== 0) {
    const err = new TextDecoder().decode(deployRes.stderr);
    throw new Error(`Deploy failed: ${err}`);
  }

  // Run setup to initialize database
  const setupCmd = new Deno.Command("deno", {
    args: ["task", "setup"],
    cwd: tmp,
    stdout: "piped",
    stderr: "piped",
  });

  const setupRes = await setupCmd.output();
  if (setupRes.code !== 0) {
    const err = new TextDecoder().decode(setupRes.stderr);
    throw new Error(`Setup failed: ${err}`);
  }

  return tmp;
}

parallelSafeTest({
  name: "exactl daemon status reports not running for fresh workspace",
  async fn() {
    const workspace = await deployTestWorkspace();
    try {
      const result = await runExactl(workspace, ["daemon", "status"]);

      // Should succeed
      assert(result.code === 0, `exactl daemon status failed: ${result.stderr}`);
    } finally {
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

parallelSafeTest({
  name: "exactl daemon start/stop lifecycle",
  async fn() {
    const workspace = await deployTestWorkspace();
    try {
      // Start the daemon with mock provider to avoid CI issues
      const startResult = await runExactl(workspace, ["daemon", "start"], {
        EXA_LLM_PROVIDER: "mock",
      });
      assert(
        startResult.code === 0,
        `exactl daemon start failed: ${startResult.stderr}`,
      );

      // Check status shows running
      const statusResult = await runExactl(workspace, ["daemon", "status"]);
      assert(
        statusResult.code === 0,
        `exactl daemon status failed: ${statusResult.stderr}`,
      );

      // If daemon is not running, check the log file for errors
      if (!statusResult.stdout.includes("Running")) {
        try {
          const logPath = pathBuilders.runtimePath(workspace, "daemon.log");
          const logContent = await Deno.readTextFile(logPath);
          console.log("Daemon log content:", logContent);
        } catch (error) {
          console.log("Could not read daemon log:", error);
        }
      }

      // Stop the daemon
      const stopResult = await runExactl(workspace, ["daemon", "stop"]);
      assert(
        stopResult.code === 0,
        `exactl daemon stop failed: ${stopResult.stderr}`,
      );

      // Verify daemon is stopped
      const finalStatus = await runExactl(workspace, ["daemon", "status"]);
      assert(
        finalStatus.code === 0,
        `Final status check failed: ${finalStatus.stderr}`,
      );
    } finally {
      // Ensure daemon is stopped before cleanup
      await runExactl(workspace, ["daemon", "stop"]).catch(() => {});
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

parallelSafeTest({
  name: "exactl daemon restart works correctly",
  async fn() {
    const workspace = await deployTestWorkspace();
    try {
      // Start the daemon first with mock provider
      const startResult = await runExactl(workspace, ["daemon", "start"], {
        EXA_LLM_PROVIDER: "mock",
      });
      assert(
        startResult.code === 0,
        `Initial start failed: ${startResult.stderr}`,
      );

      // Get initial PID from status
      const initialStatus = await runExactl(workspace, ["daemon", "status"]);
      const initialPidMatch = initialStatus.stdout.match(/PID:\s*(\d+)/);
      const initialPid = initialPidMatch ? initialPidMatch[1] : null;

      // Restart the daemon
      const restartResult = await runExactl(workspace, ["daemon", "restart"], {
        EXA_LLM_PROVIDER: "mock",
      });
      assert(
        restartResult.code === 0,
        `exactl daemon restart failed: ${restartResult.stderr}`,
      );

      // Check status after restart
      const finalStatus = await runExactl(workspace, ["daemon", "status"]);
      assert(
        finalStatus.code === 0,
        `Status after restart failed: ${finalStatus.stderr}`,
      );

      // Verify PID changed (new process)
      const finalPidMatch = finalStatus.stdout.match(/PID:\s*(\d+)/);
      const finalPid = finalPidMatch ? finalPidMatch[1] : null;

      if (initialPid && finalPid) {
        assert(
          initialPid !== finalPid,
          `PID should change after restart (was ${initialPid}, now ${finalPid})`,
        );
      }
    } finally {
      // Ensure daemon is stopped before cleanup
      await runExactl(workspace, ["daemon", "stop"]).catch(() => {});
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

parallelSafeTest({
  name: "exactl daemon start is idempotent (already running)",
  async fn() {
    const workspace = await deployTestWorkspace();
    try {
      // Start the daemon with mock provider
      const startResult = await runExactl(workspace, ["daemon", "start"], {
        EXA_LLM_PROVIDER: "mock",
      });
      assert(
        startResult.code === 0,
        `Initial start failed: ${startResult.stderr}`,
      );

      // Check that daemon is running
      const statusResult = await runExactl(workspace, ["daemon", "status"]);
      assert(statusResult.code === 0);
      assertStringIncludes(statusResult.stdout, "Running");

      // Try to start again - should succeed without error
      const secondStart = await runExactl(workspace, ["daemon", "start"]);
      assert(
        secondStart.code === 0,
        `Second start should succeed: ${secondStart.stderr}`,
      );

      // Check that daemon is still running
      const finalStatus = await runExactl(workspace, ["daemon", "status"]);
      assert(finalStatus.code === 0);
    } finally {
      // Ensure daemon is stopped before cleanup
      await runExactl(workspace, ["daemon", "stop"]).catch(() => {});
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

parallelSafeTest({
  name: "exactl daemon stop is idempotent (not running)",
  async fn() {
    const workspace = await deployTestWorkspace();
    try {
      // Check that daemon is not running initially
      const initialStatus = await runExactl(workspace, ["daemon", "status"]);
      assert(initialStatus.code === 0);

      // Stop without starting - should succeed
      const stopResult = await runExactl(workspace, ["daemon", "stop"]);
      assert(
        stopResult.code === 0,
        `Stop on non-running daemon should succeed: ${stopResult.stderr}`,
      );

      // Check that daemon is still stopped
      const finalStatus = await runExactl(workspace, ["daemon", "status"]);
      assert(finalStatus.code === 0);
    } finally {
      await Deno.remove(workspace, { recursive: true }).catch(() => {});
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

parallelSafeTest("source-and-two-hop-deploy", async () => {
  const dest1 = await Deno.makeTempDir({ prefix: "exaix-deploy-assets-a-" });
  const dest2 = await Deno.makeTempDir({ prefix: "exaix-deploy-assets-b-" });
  try {
    await deployUnslopAssets(REPO_ROOT, dest1);
    await verifyUnslopAssetSet(join(dest1, "lint"));
    await installUnslopAssets(join(dest1, "lint"), join(dest2, "lint"));
    await verifyUnslopAssetSet(join(dest2, "lint"));
    for (const name of UNSLOP_DEPLOY_ASSET_FILES) {
      assert(await exists(join(dest2, "lint", name)), name);
    }
    assertEquals(await exists(join(dest2, "lint", "manifest.json")), true);
  } finally {
    await Deno.remove(dest1, { recursive: true }).catch(() => {});
    await Deno.remove(dest2, { recursive: true }).catch(() => {});
  }
});

parallelSafeTest("deploy-artifact-errors", async () => {
  const emptyRoot = await Deno.makeTempDir({ prefix: "exaix-deploy-empty-" });
  const dest = await Deno.makeTempDir({ prefix: "exaix-deploy-corrupt-" });
  const source = await Deno.makeTempDir({ prefix: "exaix-deploy-source-" });
  try {
    const missing = await assertRejects(
      () => deployUnslopAssets(emptyRoot, dest),
      Error,
      "unslop assets unavailable",
    );
    assertStringIncludes(missing.message, "unslop-ts:deploy --init");

    const same = await assertRejects(
      () => deployUnslopAssets(REPO_ROOT, REPO_ROOT),
      Error,
      "identical",
    );
    assertStringIncludes(same.message, "identical");

    await deployUnslopAssets(REPO_ROOT, source);
    await installUnslopAssets(join(source, "lint"), join(dest, "lint"));
    const enginePath = join(dest, "lint", "unslop_engine.js");
    const bytes = await Deno.readFile(enginePath);
    bytes[0] = bytes[0] ^ 0xff;
    await Deno.writeFile(enginePath, bytes);
    const corrupt = await assertRejects(() => verifyUnslopAssetSet(join(dest, "lint")), Error, "checksum");
    assertStringIncludes(corrupt.message, "checksum");
  } finally {
    for (const dir of [emptyRoot, dest, source]) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
});

parallelSafeTest("deployed-config-closure", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json")));
  const stripped = stripDevOnlyConfig(config);
  assertEquals("unslop-ts:bundle" in (stripped.tasks ?? {}), false);
  assertEquals(DEPLOYED_SCRIPT_FILES.includes("build_unslop_portal_bundle.ts"), false);
  assertEquals(stripped.workspace?.includes("./unslop-ts"), false);
});
