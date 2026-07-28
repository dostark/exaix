/**
 * @module DaemonCommands
 * @path apps/exactl/src/commands/daemon_commands.ts
 * @description Provides CLI commands for controlling the Exaix daemon lifecycle, including start, stop, restart, status, and log tailing.
 * @architectural-layer CLI
 * @related-files ["apps/daemon/main.ts"]
 */

import { Database } from "@db/sqlite";
import { DomainEventType } from "@exaix/core/events";
import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import { STDIO_INHERIT } from "./constants.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { DAEMON_STOP_TIMEOUT_MS } from "@exaix/core";
import { DAEMON_SPAWN_PERMISSIONS } from "@exaix/core/types";
import { isProcessAlive } from "@exaix/cli/process_utils.ts";
import type { JSONObject } from "@exaix/core/types";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core/version.ts";

import type { IDaemonStatus } from "@exaix/core/types";

/** Logger actor name for daemon operations */
const DAEMON_ACTOR = "daemon";

/** How long (ms) to wait for the daemon to emit daemon.ready after the process is alive */
const DAEMON_READY_TIMEOUT_MS = 30_000;

/** How often (ms) to poll the journal for daemon.ready */
const DAEMON_READY_POLL_INTERVAL_MS = 500;

/**
 * Commands for daemon control
 */
export class DaemonCommands extends BaseCommand {
  private pidFile: string;
  private Command: typeof Deno.Command;

  constructor(context: ICommandContext & { Command?: typeof Deno.Command }) {
    super(context);
    const workspaceRoot = this.config.system.root!;
    this.pidFile = join(workspaceRoot, this.config.paths.runtime!, "daemon.pid");
    this.Command = context.Command ?? Deno.Command;
  }

  /**
   * Start the Exaix daemon
   */
  async start(): Promise<void> {
    try {
      const workspaceRoot = this.config.system.root!;
      const logFile = join(workspaceRoot, this.config.paths.runtime!, "daemon.log");

      // Find daemon script relative to this command file
      const currentFile = fromFileUrl(import.meta.url);
      const mainScript = Deno.env.get("EXA_DAEMON_SCRIPT") ||
        join(dirname(currentFile), "..", "..", "..", "..", "apps", "daemon", "main.ts");

      const status = await this.status();
      if (status.running) {
        await this.logger.info(DomainEventType.DaemonStarting, DAEMON_ACTOR, { pid: status.pid ?? null });
        console.log("daemon.already_running");
        return;
      }

      await this.logger.info(DomainEventType.DaemonStarting, DAEMON_ACTOR);

      // Check if main.ts exists
      if (!await exists(mainScript)) {
        throw new Error(
          `Daemon script not found: ${mainScript}\nEnsure Exaix is properly installed in this workspace`,
        );
      }

      // Ensure log file directory exists
      const exaDir = join(workspaceRoot, this.config.paths.runtime!);
      await ensureDir(exaDir);

      // Start daemon process in background using shell for true detachment
      // This allows the CLI to exit while daemon continues running
      const env: Record<string, string> = Deno.env.toObject();

      // Explicitly pass config path if available
      if (this.context.config) {
        env.EXA_CONFIG_PATH = this.context.config.getConfigPath();
      }

      const exaEnvVars = Object.entries(env)
        .filter(([k]) => k.startsWith("EXA_"))
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const envPrefix = exaEnvVars ? `${exaEnvVars} ` : "";

      // Build the minimal --allow-* spawn flags from config (Phase 124 R12);
      // falls back to --allow-all only on a config-read exception (logged).
      const spawnFlags = this.buildSpawnFlags().join(" ");
      const cmd = new this.Command("bash", {
        args: [
          "-c",
          `${envPrefix}nohup deno run ${spawnFlags} "${mainScript}" > "${logFile}" 2>&1 & echo $!`,
        ],
        stdout: "piped",
        stderr: "piped",
        stdin: "null",
        cwd: workspaceRoot,
      });

      const output = await cmd.output();
      const pidStr = new TextDecoder().decode(output.stdout).trim();
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid) || output.code !== 0) {
        const err = new TextDecoder().decode(output.stderr);
        throw new Error(`Failed to start daemon: ${err}`);
      }

      // Write PID file
      await Deno.writeTextFile(this.pidFile, pid.toString());

      // Wait for daemon to fully start (up to 3 seconds with retries)
      // CI environments may need more time for database initialization
      const started = await this.waitForProcessState(pid, true, 3000);

      if (!started) {
        await this.logDaemonActivity(DomainEventType.DaemonStartFailed, {
          error: "Daemon failed to start within timeout",
          pid: pid,
        });
        throw new Error("Daemon failed to start. Check logs for details.");
      }

      // Log successful start (writes to both console and IActivity Journal)
      await this.logDaemonActivity(DomainEventType.DaemonStarted, {
        pid: pid,
        log_file: logFile,
      });

      // Block until the daemon emits daemon.ready (watchers confirmed listening).
      // This eliminates the ~700ms race window between process-alive and watchers-up
      // — the CLI only returns when the daemon is genuinely ready for work.
      const ready = await this.waitForDaemonReady(workspaceRoot, pid, DAEMON_READY_TIMEOUT_MS);
      if (!ready) {
        await this.logDaemonActivity(DomainEventType.DaemonStartFailed, {
          error: "Daemon started but never reached ready state (watchers not listening)",
          pid: pid,
        });
        throw new Error(
          "Daemon failed to become ready within timeout. Check logs for details.",
        );
      }
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "DaemonCommands.start",
        args: {},
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Build the minimal `--allow-*` flag set for the daemon spawn from config
   * (Phase 124 R12). Replaces the former blanket `--allow-all`.
   *
   * Permissions: `--allow-read` (unscoped — the daemon reads the Deno cache,
   * sqlite plugin, `$HOME`, and the repo; see DAEMON_SPAWN_PERMISSIONS JSDoc),
   * `--allow-write=<config.system.root>`, `--allow-run=<DAEMON_SPAWN_RUN_BINARIES>`,
   * `--allow-env`, `--allow-ffi`, `--allow-import`, and a net flag governed by
   * `config.system.allow_net`:
   *   - `undefined` → `--allow-net=<DAEMON_DEFAULT_NET_HOSTS>`
   *   - `[]`        → no `--allow-net` flag (outbound blocked)
   *   - non-empty   → `--allow-net=host1,host2`
   *
   * GAP-2: the `--allow-all` fallback is reached ONLY when reading the config
   * throws (defence-in-depth so a malformed config never blocks startup). A
   * successfully-read `allow_net=[]` blocks outbound and must NOT fall back.
   */
  protected buildSpawnFlags(): string[] {
    try {
      const root = this.config.system.root!;
      const allowNet = this.config.system.allow_net;
      const perms = DAEMON_SPAWN_PERMISSIONS;

      // GAP-11: derive every flag from the typed DAEMON_SPAWN_PERMISSIONS struct
      // so it is the single source of truth (no hardcoded flag list that could
      // drift from the documented permission template).
      const flags: string[] = [];
      // read: empty scope list → unscoped --allow-read; otherwise scoped.
      flags.push(perms.read.length === 0 ? "--allow-read" : `--allow-read=${perms.read.join(",")}`);
      // write: the struct leaves write scope to spawn time → resolved to the data root.
      const writeScopes = perms.write.length === 0 ? [root] : perms.write;
      flags.push(`--allow-write=${writeScopes.join(",")}`);
      flags.push(`--allow-run=${perms.run.join(",")}`);
      if (perms.env) flags.push("--allow-env");
      if (perms.ffi) flags.push("--allow-ffi");
      if (perms.import) flags.push("--allow-import");

      // Net rules — empty array is an intentional block (no flag), never fallback.
      if (allowNet === undefined) {
        flags.push(`--allow-net=${perms.net.join(",")}`);
      } else if (allowNet.length > 0) {
        flags.push(`--allow-net=${allowNet.join(",")}`);
      }
      return flags;
    } catch (error) {
      // Config-read exception only: fall back to full permissions but warn loudly.
      this.logger.warn(
        DomainEventType.DaemonStarting,
        DAEMON_ACTOR,
        { fallback: "--allow-all", reason: error instanceof Error ? error.message : String(error) },
      );
      return ["--allow-all"];
    }
  }

  /**
   * Stop the Exaix daemon
   */
  async stop(): Promise<void> {
    try {
      const status = await this.status();

      if (!status.running) {
        await this.logger.info(DomainEventType.DaemonNotRunning, DAEMON_ACTOR);
        console.log("daemon.not_running");
        return;
      }

      await this.logger.info(DomainEventType.DaemonStopping, DAEMON_ACTOR, { pid: status.pid ?? null });

      try {
        // Send SIGTERM
        const killCmd = new this.Command("kill", {
          args: ["-TERM", status.pid!.toString()],
          stdout: "piped",
          stderr: "piped",
        });

        await killCmd.output();

        // Wait for process to exit (up to 5 seconds)
        const stopped = await this.waitForProcessState(status.pid!, false, DAEMON_STOP_TIMEOUT_MS);
        if (stopped) {
          await Deno.remove(this.pidFile).catch(() => {});
          await this.logDaemonActivity(DomainEventType.DaemonStopped, {
            pid: status.pid,
            method: "graceful",
          });
          return;
        }

        // Force kill if still running
        await this.logger.warn(DomainEventType.DaemonForceStopping, DAEMON_ACTOR, { pid: status.pid ?? null });
        const forceKillCmd = new this.Command("kill", {
          args: ["-KILL", status.pid!.toString()],
          stdout: "piped",
          stderr: "piped",
        });

        await forceKillCmd.output();
        await Deno.remove(this.pidFile).catch(() => {});
        await this.logDaemonActivity(DomainEventType.DaemonStopped, {
          pid: status.pid,
          method: "forced",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to stop daemon: ${message}`);
      }
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "DaemonCommands.stop",
        args: {},
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Restart the Exaix daemon
   */
  async restart(): Promise<void> {
    try {
      await this.logger.info(DomainEventType.DaemonRestarting, DAEMON_ACTOR);
      const beforeStatus = await this.status();
      await this.stop();
      // Brief pause to ensure port/resources are released
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      await this.start();
      const afterStatus = await this.status();
      await this.logDaemonActivity(DomainEventType.DaemonRestarted, {
        previous_pid: beforeStatus.pid,
        new_pid: afterStatus.pid,
      });
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "DaemonCommands.restart",
        args: {},
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Get daemon status
   * @returns Status information
   */
  async status(): Promise<IDaemonStatus> {
    const version = BINARY_VERSION;
    const workspace_schema_version = WORKSPACE_SCHEMA_VERSION;

    // Check if PID file exists
    if (!await exists(this.pidFile)) {
      return { running: false, version, workspace_schema_version };
    }

    // Read PID
    const pidStr = await Deno.readTextFile(this.pidFile);
    const pid = parseInt(pidStr.trim(), 10);

    if (isNaN(pid)) {
      return { running: false, version, workspace_schema_version };
    }

    // Check if process is running
    try {
      const alive = await isProcessAlive(pid);
      if (!alive) {
        // Process not running, clean up PID file
        await Deno.remove(this.pidFile).catch(() => {});
        return { running: false, version, workspace_schema_version };
      }

      // Get process uptime
      const psCmd = new this.Command("ps", {
        args: ["-p", pid.toString(), "-o", "etime="],
        stdout: "piped",
        stderr: "piped",
      });

      const psResult = await psCmd.output();
      const uptime = new TextDecoder().decode(psResult.stdout).trim();

      return {
        running: true,
        pid,
        uptime,
        version,
        workspace_schema_version,
      };
    } catch {
      return { running: false, version, workspace_schema_version };
    }
  }

  /**
   * Check migration compatibility between binary schema version and on-disk workspace schema.
   * Exit codes: 0 = up to date, 1 = migration required, 2 = binary older than workspace.
   */
  migrate(options: { check?: boolean; json?: boolean } = {}): number {
    if (!options.check) return 0;

    const binaryWsv = WORKSPACE_SCHEMA_VERSION;
    const onDiskWsv = (() => {
      try {
        return this.context.config.getSchemaVersion();
      } catch {
        return WORKSPACE_SCHEMA_VERSION;
      }
    })();

    const sem = (v: string) => {
      const [ma, mi, pa] = v.split(".").map(Number);
      return { major: ma ?? 0, minor: mi ?? 0, patch: pa ?? 0 };
    };

    const bsv = sem(binaryWsv);
    const dsv = sem(onDiskWsv);

    let exitCode = 0;
    let message = `✅ Workspace is up to date (schema ${onDiskWsv})`;

    if (bsv.major > dsv.major || (bsv.major === dsv.major && bsv.minor > dsv.minor)) {
      exitCode = 1;
      message = bsv.major > dsv.major
        ? `❌ Major migration required — manual upgrade needed (binary: ${binaryWsv}, workspace: ${onDiskWsv})`
        : `⚠️  Workspace migration required — run 'exactl migrate' (binary: ${binaryWsv}, workspace: ${onDiskWsv})`;
    } else if (dsv.major > bsv.major || (dsv.major === bsv.major && dsv.minor > bsv.minor)) {
      exitCode = 2;
      message = `❌ Binary is older than workspace — update exactl (binary: ${binaryWsv}, workspace: ${onDiskWsv})`;
    }

    if (options.json) {
      console.log(JSON.stringify({ status: exitCode === 0 ? "ok" : "mismatch", exit_code: exitCode, message }));
    } else {
      console.log(message);
    }

    return exitCode;
  }

  /**
   * Show daemon logs
   * @param lines Number of lines to show
   * @param follow Follow log output (tail -f)
   */
  async logs(lines: number = CLI_DEFAULTS.LOG_LINES, follow: boolean = false): Promise<void> {
    try {
      const logFile = join(this.config.system.root!, this.config.paths.runtime!, "daemon.log");

      if (!await exists(logFile)) {
        await this.logger.info(DomainEventType.DaemonNoLogs, logFile, { hint: "Daemon may not have been started yet" });
        console.log("daemon.no_logs");
        return;
      }

      const args = ["-n", lines.toString()];
      if (follow) {
        args.push("-f");
      }
      args.push(logFile);

      const cmd = new this.Command("tail", {
        args,
        stdout: STDIO_INHERIT,
        stderr: STDIO_INHERIT,
      });

      const process = cmd.spawn();
      await process.status;
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "DaemonCommands.logs",
        args: { lines, follow },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Wait for a process to reach a desired state (running or stopped)
   * @param pid Process ID to check
   * @param shouldBeRunning Expected state (true = running, false = stopped)
   * @param timeoutMs Maximum time to wait in milliseconds
   * @returns true if desired state reached, false if timeout
   */
  private async waitForProcessState(
    pid: number,
    shouldBeRunning: boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = CLI_DEFAULTS.DAEMON_CHECK_INTERVAL_MS; // Check every 50ms

    while (Date.now() - startTime < timeoutMs) {
      const isRunning = await isProcessAlive(pid);
      if (isRunning === shouldBeRunning) {
        return true;
      }
      // Use queueMicrotask for first check, then small intervals
      if (Date.now() - startTime < checkInterval) {
        await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      } else {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }
    }
    return false;
  }

  /**
   * Poll the workspace journal for daemon.ready (the daemon process's signal that every
   * file-watcher is confirmed listening).  Used after waitForProcessState to close the
   * ~700ms race window between process-alive and watchers-up — the CLI only returns once
   * the daemon is genuinely able to process incoming work.
   *
   * @returns true when daemon.ready is found, false on timeout or if the daemon dies.
   */
  protected async waitForDaemonReady(
    workspaceRoot: string,
    pid: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const dbPath = join(workspaceRoot, ".exa", "journal.db");

    // Baseline: only events written AFTER this wait begins count. This prevents a
    // stale daemon.ready from a previous daemon instance (e.g. after restart) from
    // satisfying the wait for a new daemon that hasn't finished booting yet.
    const sinceRowid = await this.journalMaxRowid(dbPath);

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!await isProcessAlive(pid)) return false;

      if (await this.journalHasEvent(dbPath, DomainEventType.DaemonReady, sinceRowid)) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, DAEMON_READY_POLL_INTERVAL_MS));
    }
    return false;
  }

  /**
   * Maximum rowid in the activity table, or 0 if the journal doesn't exist yet.
   */
  private async journalMaxRowid(dbPath: string): Promise<number> {
    try {
      await Deno.stat(dbPath);
    } catch {
      return 0;
    }
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number | null }>();
        return row?.m ?? 0;
      } finally {
        db.close();
      }
    } catch {
      return 0;
    }
  }

  /**
   * True if the activity table contains an event of `eventType` with a rowid greater
   * than `sinceRowid`. Tolerant of missing/empty journal.
   */
  private async journalHasEvent(
    dbPath: string,
    eventType: string,
    sinceRowid: number,
  ): Promise<boolean> {
    try {
      await Deno.stat(dbPath);
    } catch {
      return false;
    }
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db
          .prepare("SELECT 1 FROM activity WHERE action_type = ? AND rowid > ? LIMIT 1")
          .get(eventType, sinceRowid);
        return row !== undefined;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * Log daemon activity to the activity journal using EventLogger
   */
  protected async logDaemonActivity(actionType: string, payload: JSONObject): Promise<void> {
    try {
      const actionLogger = await this.getActionLogger();
      actionLogger.info(actionType, DAEMON_ACTOR, {
        ...payload,
        timestamp: new Date().toISOString(),
        via: "cli",
        command: this.getCommandLineString(),
      });
    } catch (error) {
      // Log errors but don't fail the operation
      console.error("Failed to log daemon activity:", error);
    }
  }

  /**
   * Check if daemon is running
   */
  protected async isRunning(): Promise<boolean> {
    const status = await this.status();
    return status.running;
  }
}
