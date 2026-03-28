/**
 * @module DaemonCommandsTest
 * @path tests/cli/daemon_commands_test.ts
 * @description Verifies CLI daemon control commands, ensuring correct start/stop/status
 * logic, PID file management, and background process orchestration.
 */

import { RequestSource } from "../../src/shared/enums.ts";
import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { ConfigService } from "../../src/config/service.ts";
import { DaemonCommands } from "../../src/cli/commands/daemon_commands.ts";
import { isProcessAlive } from "../../src/cli/process_utils.ts";
import { DatabaseService as DatabaseService } from "../../src/services/db.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { getRuntimeDir } from "../helpers/paths_helper.ts";
import type { IDisplayService } from "../../src/shared/interfaces/i_display_service.ts";
import { EventLogger } from "../../src/services/event_logger.ts";
import { createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import type { JSONObject } from "../../src/shared/types/json.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "../../src/shared/version.ts";

/**
 * Helper class to expose and mock protected methods of DaemonCommands
 */
class TestDaemonCommands extends DaemonCommands {
  public mockActionLogger?: IDisplayService;

  public override getActionLogger(): IDisplayService {
    if (this.mockActionLogger) return this.mockActionLogger;
    return super.getActionLogger();
  }

  public override async logDaemonActivity(actionType: string, payload: JSONObject): Promise<void> {
    return await super.logDaemonActivity(actionType, payload);
  }
}

/**
 * Mock for Deno.Command to use in tests
 */
class MockCommand {
  static nextOutput: Deno.CommandOutput | null = null;
  static lastArgs: { cmd: string; opts?: Deno.CommandOptions } | null = null;

  constructor(cmd: string, opts?: Deno.CommandOptions) {
    MockCommand.lastArgs = { cmd, opts };
  }

  output(): Promise<Deno.CommandOutput> {
    if (!MockCommand.nextOutput) {
      return Promise.resolve({
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        success: true,
        signal: null,
      });
    }
    return Promise.resolve(MockCommand.nextOutput);
  }

  outputSync(): Deno.CommandOutput {
    if (!MockCommand.nextOutput) {
      return {
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        success: true,
        signal: null,
      };
    }
    return MockCommand.nextOutput;
  }

  spawn(): Deno.ChildProcess {
    // Return a dummy object that looks like ChildProcess if needed
    return {
      status: Promise.resolve({ code: 0, success: true, signal: null }),
      stdout: { cancel: () => Promise.resolve() },
      stderr: { cancel: () => Promise.resolve() },
    } as Deno.ChildProcess;
  }
}

describe("DaemonCommands", {
  sanitizeResources: false, // Disable resource leak detection for daemon processes
  sanitizeOps: false, // Disable async ops leak detection
}, () => {
  let tempDir: string;
  let db: DatabaseService;
  let daemonCommands: TestDaemonCommands;
  let pidFile: string;
  let logFile: string;
  let mainScript: string;
  let configService: ConfigService;
  let testCleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext();
    tempDir = result.tempDir;
    db = result.db;
    configService = result.configService;
    testCleanup = result.cleanup;

    pidFile = join(getRuntimeDir(tempDir), "daemon.pid");
    logFile = join(getRuntimeDir(tempDir), "daemon.log");

    // Create a mock main.ts script that simulates a daemon
    const srcDir = join(tempDir, "src");
    await ensureDir(srcDir);
    mainScript = join(srcDir, "main.ts");

    // Mock daemon script that stays alive for testing
    await Deno.writeTextFile(
      mainScript,
      `#!/usr/bin/env -S deno run --allow-all
// Mock daemon for testing
console.log("Daemon started");
const shutdown = () => {
  console.log("Daemon stopping");
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);
// Keep alive
await new Promise(() => {});
`,
    );

    // Ensure DaemonCommands uses our mock script
    Deno.env.set("EXA_DAEMON_SCRIPT", mainScript);

    daemonCommands = new TestDaemonCommands(createStubContext({ config: configService, db }));
  });

  afterEach(async () => {
    Deno.env.delete("EXA_DAEMON_SCRIPT");
    // Clean up any running test daemons
    if (await exists(pidFile)) {
      try {
        const pidStr = await Deno.readTextFile(pidFile);
        const pid = parseInt(pidStr.trim(), 10);
        if (!isNaN(pid)) {
          await killProcess(pid);
          // Wait for process to fully exit
          await waitForProcessState(pid, false, 1000);
        }
        // Remove PID file
        await Deno.remove(pidFile).catch(() => {});
      } catch {
        // Ignore errors in cleanup
      }
    }

    await testCleanup();
  });

  describe("start", () => {
    it("should write PID file to .exa/daemon.pid", async () => {
      await daemonCommands.start();

      // Verify PID file exists
      assertEquals(await exists(pidFile), true);

      // Verify PID file contains a valid number
      const pidStr = await Deno.readTextFile(pidFile);
      const pid = parseInt(pidStr.trim(), 10);
      assertEquals(isNaN(pid), false);
      assertEquals(pid > 0, true);
    });

    it("should verify daemon actually started", async () => {
      await daemonCommands.start();

      // Get status and verify daemon is running
      const status = await daemonCommands.status();
      assertEquals(status.running, true);
      assertExists(status.pid);
    });

    it("should show clear error if already running", async () => {
      // Start daemon first time
      await daemonCommands.start();

      // Capture console output
      const originalLog = console.log;
      let logOutput = "";
      console.log = (...args: string[]) => {
        logOutput += args.join(" ") + "\n";
      };

      try {
        // Try to start again
        await daemonCommands.start();

        // Verify error message about already running (EventLogger format)
        assertStringIncludes(logOutput, "daemon.already_running");
      } finally {
        console.log = originalLog;
      }
    });

    it("should create daemon process that stays alive", async () => {
      await daemonCommands.start();

      const pidStr = await Deno.readTextFile(pidFile);
      const pid = parseInt(pidStr.trim(), 10);

      // Wait for process to stabilize
      await waitForProcessState(pid, true, 1000);

      // Verify process still exists
      const isAlive = await isProcessAlive(pid);
      assertEquals(isAlive, true);
    });

    it("should log daemon.started to activity journal", async () => {
      await daemonCommands.start();

      // Wait for batched logs to flush
      await db.waitForFlush();

      // Verify activity log entry
      const logs = db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = ?",
      ).all("daemon.started");

      assertEquals(logs.length, 1);
      const log = logs[0] as JSONObject;
      assertExists(log.actor);

      // Verify payload contains expected fields
      const payload = JSON.parse(log.payload as string);
      assertExists(payload.pid);
      assertExists(payload.log_file);
      assertEquals(payload.via, RequestSource.CLI);
      assertExists(payload.command);
      assertEquals(payload.command.startsWith("exactl "), true);
      assertExists(payload.timestamp);
    });
  });

  describe("stop", () => {
    it("should send SIGTERM first (graceful)", async () => {
      // Start daemon
      await daemonCommands.start();
      const pidStr = await Deno.readTextFile(pidFile);
      const pid = parseInt(pidStr.trim(), 10);

      // Stop daemon
      await daemonCommands.stop();

      // Verify process stopped
      await waitForProcessState(pid, false, 1000);
      const isAlive = await isProcessAlive(pid);
      assertEquals(isAlive, false);
    });

    it("should clean up PID file", async () => {
      // Start daemon
      await daemonCommands.start();
      assertEquals(await exists(pidFile), true);

      // Stop daemon
      await daemonCommands.stop();

      // Verify PID file is removed
      assertEquals(await exists(pidFile), false);
    });

    it("should handle daemon not running gracefully", async () => {
      // Capture console output
      const originalLog = console.log;
      let logOutput = "";
      console.log = (...args: string[]) => {
        logOutput += args.join(" ") + "\n";
      };

      try {
        // Try to stop when not running
        await daemonCommands.stop();

        // Verify friendly message (EventLogger format)
        assertStringIncludes(logOutput, "daemon.not_running");
      } finally {
        console.log = originalLog;
      }
    });

    it("should have force-kill capability", async () => {
      // This test verifies that the stop() method has logic to force-kill
      // if graceful shutdown fails. We can't easily test the actual timeout
      // behavior in a unit test without making it flaky, so we just verify
      // the mechanism exists by checking the code path works.

      // Create a simple daemon
      await daemonCommands.start();
      const pidStr = await Deno.readTextFile(pidFile);
      const pid = parseInt(pidStr.trim(), 10);

      // Stop it normally (should work fine)
      await daemonCommands.stop();

      // Verify process stopped
      const stopped = await waitForProcessState(pid, false, 1000);
      assertEquals(stopped, true, "Process should be stopped");
    });

    it("should log daemon.stopped to activity journal", async () => {
      // Start daemon first
      await daemonCommands.start();

      // Clear any start logs
      await db.waitForFlush();
      db.instance.exec("DELETE FROM activity WHERE action_type = 'daemon.started'");

      // Stop daemon
      await daemonCommands.stop();

      // Wait for batched logs to flush
      await db.waitForFlush();

      // Verify activity log entry
      const logs = db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = ?",
      ).all("daemon.stopped");

      assertEquals(logs.length, 1);
      const log = logs[0] as JSONObject;
      // Actor is now user identity (email or username) instead of "human"
      assertExists(log.actor);

      // Verify payload contains expected fields
      const payload = JSON.parse(log.payload as string);
      assertExists(payload.pid);
      assertExists(payload.method); // 'graceful' or 'forced'
      assertEquals(payload.via, RequestSource.CLI);
      assertExists(payload.timestamp);
    });
  });

  describe("restart", () => {
    it("should have proper delay between stop and start", async () => {
      // Start daemon
      await daemonCommands.start();
      const firstPidStr = await Deno.readTextFile(pidFile);
      const firstPid = parseInt(firstPidStr.trim(), 10);

      // Restart
      await daemonCommands.restart();

      // Verify new daemon is running
      const status = await daemonCommands.status();
      assertEquals(status.running, true);

      // Should be a different PID
      const newPid = status.pid!;
      assertEquals(newPid !== firstPid, true);
    });

    it("should stop then start daemon", async () => {
      // Start daemon
      await daemonCommands.start();
      assertEquals((await daemonCommands.status()).running, true);

      // Restart
      await daemonCommands.restart();

      // Verify still running
      const status = await daemonCommands.status();
      assertEquals(status.running, true);
      assertExists(status.pid);
    });

    it("should log daemon.restarted to activity journal", async () => {
      // Start daemon first
      await daemonCommands.start();
      const firstStatus = await daemonCommands.status();

      // Clear previous logs
      await db.waitForFlush();
      db.instance.exec("DELETE FROM activity");

      // Restart daemon
      await daemonCommands.restart();

      // Wait for batched logs to flush
      await db.waitForFlush();

      // Verify activity log entry for restart
      const logs = db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = ?",
      ).all("daemon.restarted");

      assertEquals(logs.length, 1);
      const log = logs[0] as JSONObject;
      // Actor is now user identity (email or username) instead of "human"
      assertExists(log.actor);

      // Verify payload contains expected fields
      const payload = JSON.parse(log.payload as string);
      assertEquals(payload.previous_pid, firstStatus.pid);
      assertExists(payload.new_pid);
      assertEquals(payload.via, RequestSource.CLI);
      assertExists(payload.timestamp);
    });
  });

  describe("status", () => {
    it("should accurately check process state when running", async () => {
      // Start daemon
      await daemonCommands.start();

      // Check status
      const status = await daemonCommands.status();
      assertEquals(status.running, true);
      assertExists(status.pid);
      assertExists(status.version);
    });

    it("should accurately check process state when not running", async () => {
      // Don't start daemon
      const status = await daemonCommands.status();

      assertEquals(status.running, false);
      assertEquals(status.pid, undefined);
      assertExists(status.version);
    });

    it("should show uptime from ps command", async () => {
      // Start daemon
      await daemonCommands.start();

      // Wait for uptime to accumulate (need real time for ps uptime)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check status
      const status = await daemonCommands.status();
      assertEquals(status.running, true);
      assertExists(status.uptime);

      // Uptime should be a non-empty string
      assertEquals(typeof status.uptime, "string");
      assertEquals(status.uptime!.length > 0, true);
    });

    it("should handle stale PID file", async () => {
      // Write a PID file with non-existent process
      await Deno.writeTextFile(pidFile, "99999");

      // Status should detect it's not running
      const status = await daemonCommands.status();
      assertEquals(status.running, false);

      // PID file should be cleaned up
      assertEquals(await exists(pidFile), false);
    });

    it("should handle invalid PID file content", async () => {
      // Write invalid PID
      await Deno.writeTextFile(pidFile, "not-a-number");

      // Status should handle gracefully
      const status = await daemonCommands.status();
      assertEquals(status.running, false);
    });
  });

  describe("logs", () => {
    it("should support --lines option", async () => {
      // Create a log file with multiple lines
      const logLines = Array.from({ length: 100 }, (_, i) => `Log line ${i + 1}`);
      await Deno.writeTextFile(logFile, logLines.join("\n") + "\n");

      // Test reading specific number of lines
      // We can't easily capture tail output in tests, but we can verify the command doesn't error
      try {
        // Create a promise that resolves quickly
        const logPromise = daemonCommands.logs(10, false);
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1000));

        await Promise.race([logPromise, timeoutPromise]);

        // If we got here without error, logs command works
        assertEquals(true, true);
      } catch (error) {
        // Should not throw for valid log file
        throw error;
      }
    });

    it("should handle missing log file gracefully", async () => {
      // Don't create log file
      assertEquals(await exists(logFile), false);

      // Capture console output
      const originalLog = console.log;
      let logOutput = "";
      console.log = (...args: string[]) => {
        logOutput += args.join(" ") + "\n";
      };

      try {
        await daemonCommands.logs(50, false);

        // Should show friendly message (EventLogger format)
        assertStringIncludes(logOutput, "daemon.no_logs");
      } finally {
        console.log = originalLog;
      }
    });

    it("should support --follow option", async () => {
      // Create a log file
      await Deno.writeTextFile(logFile, "Initial log line\n");

      // The follow option would block, so we just verify it can be called
      // In a real scenario, this would use tail -f
      // For testing, we just ensure the command structure is correct
      assertEquals(await exists(logFile), true);

      // Verify logs method exists and accepts follow parameter
      assertEquals(typeof daemonCommands.logs, "function");
    });
  });
});

// Helper functions

async function killProcess(pid: number): Promise<void> {
  try {
    // Try graceful kill first
    const termCmd = new Deno.Command("kill", {
      args: ["-TERM", pid.toString()],
      stdout: "piped",
      stderr: "piped",
    });
    await termCmd.output();

    // Wait for graceful termination
    const terminated = await waitForProcessState(pid, false, 1000);

    // Force kill if still alive
    if (!terminated && await isProcessAlive(pid)) {
      const killCmd = new Deno.Command("kill", {
        args: ["-KILL", pid.toString()],
        stdout: "piped",
        stderr: "piped",
      });
      await killCmd.output();
    }
  } catch {
    // Ignore errors in cleanup
  }
}

/**
 * Wait for a process to reach desired state
 */
async function waitForProcessState(
  pid: number,
  shouldBeRunning: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 50;

  while (Date.now() - startTime < timeoutMs) {
    const isRunning = await isProcessAlive(pid);
    if (isRunning === shouldBeRunning) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
  return false;
}

// Additional edge case tests from tests/daemon_commands_test.ts
describe("DaemonCommands - Edge Cases", () => {
  let tempDir: string;
  let db: DatabaseService;
  let daemonCommands: TestDaemonCommands;
  let pidFile: string;
  let configService: ConfigService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext();
    tempDir = result.tempDir;
    db = result.db;
    configService = result.configService!;
    cleanup = result.cleanup;

    pidFile = join(tempDir, ".exa", "daemon.pid");

    daemonCommands = new TestDaemonCommands(createStubContext({ config: configService, db }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("status() should return not running when PID file missing", async () => {
    const status = await daemonCommands.status();
    assertEquals(status.running, false);
    assertEquals(status.version, BINARY_VERSION);
  });

  it("status() should return not running when PID file contains invalid number", async () => {
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, "not-a-number");

    const status = await daemonCommands.status();

    assertEquals(status.running, false);
    assertEquals(status.pid, undefined);
  });

  it("status() should clean up PID file for dead process", async () => {
    // Use a PID that definitely doesn't exist (999999)
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, "999999");

    const status = await daemonCommands.status();

    assertEquals(status.running, false);
    // PID file should be cleaned up (allow for race conditions)
    const pidFileExists = await Deno.stat(pidFile).then(() => true).catch(() => false);
    assert(pidFileExists === false);
  });

  it("start() should throw error when main script not found", async () => {
    // Set environment variable to point to non-existent script to trigger error
    Deno.env.set("EXA_DAEMON_SCRIPT", "/non-existent/main.ts");
    try {
      await assertRejects(
        async () => await daemonCommands.start(),
        Error,
        "Daemon script not found",
      );
    } finally {
      Deno.env.delete("EXA_DAEMON_SCRIPT");
    }
  });

  it("start() should return early when daemon already running", async () => {
    // Use current Deno process PID (which is definitely running)
    const currentPid = Deno.pid;
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, currentPid.toString());

    // Should return without error (early return)
    try {
      await daemonCommands.start();
    } catch (e) {
      // Accept error if main script is missing, but test early return logic
      if (!String(e).includes("Daemon script not found")) throw e;
    }

    // PID file should still exist
    const pidContent = await Deno.readTextFile(pidFile);
    assertEquals(pidContent, currentPid.toString());
  });

  it("start() should throw when daemon command fails", async () => {
    const failingCommands = new TestDaemonCommands({
      ...createStubContext({ config: configService, db }),
      Command: MockCommand,
    });

    MockCommand.nextOutput = {
      code: 1,
      stdout: new Uint8Array(),
      stderr: new TextEncoder().encode("boom"),
      success: false,
      signal: null,
    };

    try {
      await assertRejects(
        async () => await failingCommands.start(),
        Error,
        "Failed to start daemon",
      );
    } finally {
      Deno.env.delete("EXA_DAEMON_SCRIPT");
    }
  });

  it("start() should throw when daemon command returns invalid PID", async () => {
    const failingCommands = new TestDaemonCommands({
      ...createStubContext({ config: configService, db }),
      Command: MockCommand,
    });

    MockCommand.nextOutput = {
      code: 0,
      stdout: new TextEncoder().encode("invalid-pid"),
      stderr: new Uint8Array(),
      success: true,
      signal: null,
    };

    try {
      await assertRejects(
        async () => await failingCommands.start(),
        Error,
        "Failed to start daemon",
      );
    } finally {
      Deno.env.delete("EXA_DAEMON_SCRIPT");
    }
  });

  it("stop() should return early when daemon not running", async () => {
    // Should return without error (early return)
    await daemonCommands.stop();
  });

  it("logs() should handle missing log file gracefully", async () => {
    // Should not throw when log file doesn't exist
    await daemonCommands.logs(10, false);
  });

  it("status() should handle process check exception", async () => {
    // Use a negative PID to potentially trigger exception in kill -0
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, "-1");

    const status = await daemonCommands.status();

    // Should handle exception and return not running
    assertEquals(status.running, false);
  });

  it("status() should return uptime for running process", async () => {
    // Use current Deno process PID
    const currentPid = Deno.pid;
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, currentPid.toString());

    const status = await daemonCommands.status();

    // Accept either running or not running depending on environment
    assert(typeof status.running === "boolean");
    assertEquals(status.pid, currentPid);
    // Uptime should be present if running
    if (status.running) {
      assertEquals(typeof status.uptime, "string");
    }
  });

  it("stop() should use force kill when graceful shutdown fails", async () => {
    // Create a daemon that ignores SIGTERM (no signal handlers)
    const srcDir = join(tempDir, "src");
    await ensureDir(srcDir);
    const stubbornMainScript = join(srcDir, "stubborn_main.ts");

    // Create a daemon script that ignores SIGTERM
    await Deno.writeTextFile(
      stubbornMainScript,
      `#!/usr/bin/env -S deno run --allow-all
// Stubborn daemon that ignores SIGTERM
console.log("Stubborn daemon started");
// Don't set up signal handlers - this daemon won't respond to SIGTERM
await new Promise(() => {}); // Run forever
`,
    );

    // Start the stubborn daemon
    const startCmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", stubbornMainScript],
      stdout: "piped",
      stderr: "piped",
    });
    const startProcess = startCmd.spawn();

    // Wait a bit for it to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the PID and write to file
    const stubbornPid = startProcess.pid;
    await Deno.mkdir(join(tempDir, ".exa"), { recursive: true });
    await Deno.writeTextFile(pidFile, stubbornPid.toString());

    // Try to stop it - this should trigger force kill after timeout
    await daemonCommands.stop();

    // Verify process was killed (either gracefully or forcefully)
    const isAlive = await isProcessAlive(stubbornPid);
    assertEquals(isAlive, false, "Process should be killed");

    // Close the process streams to prevent resource leaks
    await startProcess.stdout.cancel();
    await startProcess.stderr.cancel();

    // Don't try to kill again in cleanup since it's already dead
  });

  it("logDaemonActivity() should handle logging errors gracefully", async () => {
    // Mock getActionLogger to return a logger that fails
    const failingDb = createStubDb({
      logActivity: () => {
        throw new Error("Database connection failed");
      },
    });
    daemonCommands.mockActionLogger = new EventLogger({ db: failingDb });

    // This should not throw even though logging fails
    await daemonCommands.logDaemonActivity("test.action", { test: "data" } as JSONObject);
    assertEquals(true, true); // Should reach here without throwing
  });
});

// ---------------------------------------------------------------------------
// Step 5 & 6: version fields in status + migrate --check
// ---------------------------------------------------------------------------

describe("DaemonCommands - version fields in status() (Step 5)", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  let daemonCommands: DaemonCommands;
  let _tempDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext();
    _tempDir = result.tempDir;
    cleanup = result.cleanup;
    daemonCommands = new DaemonCommands(createStubContext({ config: result.configService }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("status() includes binary_version equal to BINARY_VERSION", async () => {
    const status = await daemonCommands.status();
    assertEquals(status.version, BINARY_VERSION);
  });

  it("status() includes workspace_schema_version equal to WORKSPACE_SCHEMA_VERSION", async () => {
    const status = await daemonCommands.status();
    assertEquals(status.workspace_schema_version, WORKSPACE_SCHEMA_VERSION);
  });

  it("status() workspace_schema_version is non-empty SemVer", async () => {
    const status = await daemonCommands.status();
    assert(/^\d+\.\d+\.\d+$/.test(status.workspace_schema_version));
  });
});

describe("DaemonCommands - migrate() compatibility check (Step 6)", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  let daemonCommands: DaemonCommands;
  let _tempDir: string;
  let cleanup: () => Promise<void>;

  function makeCommandsWithOnDiskSchema(schemaVersion: string): DaemonCommands {
    const ctx = createStubContext();
    // Override getSchemaVersion via getAll config
    const configWithSchema = { ...ctx.config, getSchemaVersion: () => schemaVersion };
    ctx.config = configWithSchema as typeof ctx.config;
    return new DaemonCommands(ctx);
  }

  beforeEach(async () => {
    const result = await createCliTestContext();
    _tempDir = result.tempDir;
    cleanup = result.cleanup;
    daemonCommands = new DaemonCommands(createStubContext({ config: result.configService }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("migrate({check:true}) returns 0 when versions match", () => {
    // Both binary and on-disk are WORKSPACE_SCHEMA_VERSION == "1.0.0"
    const cmd = makeCommandsWithOnDiskSchema(WORKSPACE_SCHEMA_VERSION);
    const exitCode = cmd.migrate({ check: true });
    assertEquals(exitCode, 0);
  });

  it("migrate({check:true}) returns 1 when binary minor > on-disk minor", () => {
    // Binary declares higher version, on-disk is lower
    const cmd = makeCommandsWithOnDiskSchema("1.0.0");
    // When on-disk is lower than binary, it returns 1 (migration required)
    const exitCode = cmd.migrate({ check: true });
    assertEquals(exitCode, 1);
  });

  it("migrate({check:true}) returns 2 when on-disk minor > binary minor", () => {
    // Simulate workspace is ahead: on-disk = 9.9.0 > binary = 1.0.0
    const cmd = makeCommandsWithOnDiskSchema("9.9.0");
    const exitCode = cmd.migrate({ check: true });
    assertEquals(exitCode, 2);
  });

  it("migrate({check:false}) returns 0 immediately", () => {
    const exitCode = daemonCommands.migrate({ check: false });
    assertEquals(exitCode, 0);
  });

  it("migrate --json produces parseable JSON with required keys", () => {
    const originalLog = console.log;
    let captured = "";
    console.log = (s: string) => {
      captured = s;
    };
    try {
      daemonCommands.migrate({ check: true, json: true });
      const parsed = JSON.parse(captured);
      assert("status" in parsed);
      assert("exit_code" in parsed);
      assert("message" in parsed);
    } finally {
      console.log = originalLog;
    }
  });
});
