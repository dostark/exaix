/**
 * @module ExaCtlDaemonCommand
 * @path apps/exactl/src/command_builders/daemon_command.ts
 * @description Builds the exactl daemon command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import { GIT_CMD_STATUS } from "@exaix/git/constants.ts";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import type { JSONValue } from "@exaix/core";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";
import { actionOutput, ColumnHeader, readGlobalOptions } from "../output/exactl_output.ts";

const DAEMON_ID = "daemon";
const NOT_AVAILABLE_LABEL = "(not available)";
const RUNNING_LABEL = "Running ✓";
const STOPPED_LABEL = "Stopped ✗";

interface IVersionInfo {
  [key: string]: JSONValue;
  binary_version: string;
  workspace_schema_version: string;
  on_disk_schema_version: string;
  compatible: boolean;
  migration_required: boolean;
  config_path: string;
}

interface IDaemonStatusRow {
  [key: string]: JSONValue;
  status: string;
  pid: number | null;
  uptime: string | null;
  binary_version: string;
  workspace_schema_version: string;
}

const DAEMON_STATUS_FIELDS: readonly IExaCtlColumn<IDaemonStatusRow>[] = [
  { header: ColumnHeader.STATUS, value: (row) => row.status === "running" ? RUNNING_LABEL : STOPPED_LABEL },
  { header: "PID", value: (row) => String(row.pid ?? "-") },
  { header: "Uptime", value: (row) => row.uptime ?? "-" },
  { header: "Binary", value: (row) => row.binary_version },
  { header: "Schema", value: (row) => row.workspace_schema_version },
];

function createDaemonCommand(runtime: IExaCtlRuntime) {
  const { display, daemonCommands } = runtime;
  const noun = nounDocFor(ExaCtlCommandName.DAEMON);
  const mutate = async <T extends object | void>(
    action: string,
    options: T,
    work: (renderer: ReturnType<typeof actionOutput>["renderer"]) => Promise<void>,
  ): Promise<void> => {
    try {
      await work(actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer);
    } catch (error) {
      failCommand(display, action, error as Error);
    }
  };
  const command = documentedNoun(new Command(), noun)
    .command(
      ExaCtlVerb.START,
      new Command()
        .option(
          "--ready-timeout <ms:number>",
          "Milliseconds to wait for daemon.ready (default: daemon.ready_timeout_ms)",
        )
        .action((options) =>
          mutate("daemon start", options, async (renderer) => {
            const wasRunning = (await daemonCommands.status()).running;
            await daemonCommands.start({ readyTimeoutMs: options.readyTimeout });
            const status = wasRunning ? MutationStatus.ALREADY_RUNNING : MutationStatus.STARTED;
            display.info("cli.daemon.start", DAEMON_ID, { status });
            await renderer.mutation([{ id: DAEMON_ID, action: ExaCtlVerb.START, status }], false);
          })
        ),
    )
    .command(
      ExaCtlVerb.STOP,
      new Command().action((options) =>
        mutate("daemon stop", options, async (renderer) => {
          const wasRunning = (await daemonCommands.status()).running;
          await daemonCommands.stop();
          const status = wasRunning ? MutationStatus.STOPPED : MutationStatus.NOT_RUNNING;
          display.info("cli.daemon.stop", DAEMON_ID, { status });
          await renderer.mutation([{ id: DAEMON_ID, action: ExaCtlVerb.STOP, status }], false);
        })
      ),
    )
    .command(
      ExaCtlVerb.RESTART,
      new Command().action((options) =>
        mutate("daemon restart", options, async (renderer) => {
          await daemonCommands.restart();
          display.info("cli.daemon.restart", DAEMON_ID, { status: MutationStatus.RESTARTED });
          await renderer.mutation(
            [{ id: DAEMON_ID, action: ExaCtlVerb.RESTART, status: MutationStatus.RESTARTED }],
            false,
          );
        })
      ),
    )
    .command(
      GIT_CMD_STATUS,
      new Command()
        .action(async (options) => {
          try {
            const status = await daemonCommands.status();
            const row: IDaemonStatusRow = {
              status: status.running ? "running" : "stopped",
              pid: status.pid ?? null,
              uptime: status.uptime ?? null,
              binary_version: status.version,
              workspace_schema_version: status.workspace_schema_version,
            };
            await actionOutput(runtime, options, ExaCtlOutputFormat.TEXT).renderer.item(row, DAEMON_STATUS_FIELDS);
          } catch (error) {
            failCommand(display, "daemon status", error as Error);
          }
        }),
    )
    .command(
      ExaCtlVerb.LOGS,
      new Command()
        .option("-n, --limit <lines:number>", "Number of lines to show", { default: CLI_DEFAULTS.LOG_LINES })
        .option("-f, --follow", "Follow log output")
        .action(async (options) => {
          try {
            const hasLogs = await daemonCommands.logs(options.limit, options.follow);
            if (!hasLogs) {
              display.warn("cli.daemon.logs", DAEMON_ID, { message: "The daemon has not written a log yet." });
            }
          } catch (error) {
            failCommand(display, "daemon logs", error as Error);
          }
        }),
    );
  documentLeaves(command, [ExaCtlCommandName.DAEMON], noun.lifecycle);
  return command;
}

export function buildDaemonCommand(runtime: IExaCtlRuntime): ReturnType<typeof createDaemonCommand> {
  return createDaemonCommand(runtime);
}

function createVersionCommand(runtime: IExaCtlRuntime) {
  const { services } = runtime;
  return new Command()
    .description("Show Exaix binary and workspace schema version information")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      const onDiskSchemaVersion = (() => {
        try {
          return services.config.getSchemaVersion();
        } catch {
          return WORKSPACE_SCHEMA_VERSION;
        }
      })();

      const wsv = parseSemVerSegments(WORKSPACE_SCHEMA_VERSION);
      const ondisk = parseSemVerSegments(onDiskSchemaVersion);

      const migrationRequired = wsv.major > ondisk.major ||
        (wsv.major === ondisk.major && wsv.minor > ondisk.minor);
      const binaryTooOld = ondisk.major > wsv.major ||
        (ondisk.major === wsv.major && ondisk.minor > wsv.minor);
      const compatible = !migrationRequired && !binaryTooOld;

      const compatibilityLabel = migrationRequired
        ? "⚠️  Minor migration required"
        : binaryTooOld
        ? "❌ Binary older than workspace — update exactl"
        : "✅ OK";

      const configPath = (() => {
        try {
          return services.config.getConfigPath();
        } catch {
          return "";
        }
      })();
      const info: IVersionInfo = {
        binary_version: BINARY_VERSION,
        workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
        on_disk_schema_version: onDiskSchemaVersion,
        compatible,
        migration_required: migrationRequired,
        config_path: configPath,
      };
      const fields: readonly IExaCtlColumn<IVersionInfo>[] = [
        { header: "Binary version", value: (row) => row.binary_version },
        { header: "Workspace schema version", value: (row) => row.workspace_schema_version },
        { header: "Config path", value: (row) => row.config_path || NOT_AVAILABLE_LABEL },
        { header: "On-disk schema version", value: (row) => row.on_disk_schema_version },
        { header: "Compatibility", value: () => compatibilityLabel },
      ];
      await renderer.item(info, fields);
    });
}

export function buildVersionCommand(runtime: IExaCtlRuntime): ReturnType<typeof createVersionCommand> {
  return createVersionCommand(runtime);
}

/** Minimal inline SemVer parser (avoids circular import of scripts/check_version.ts) */
function parseSemVerSegments(v: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = v.split(".").map(Number);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

function createMigrateCommand(runtime: IExaCtlRuntime) {
  const { daemonCommands } = runtime;
  return new Command()
    .description("Workspace migration utilities")
    .command(
      "check",
      new Command()
        .description("Check binary vs workspace schema compatibility")
        .action((options) => {
          const exitCode = daemonCommands.migrate({ check: true, json: readGlobalOptions(options).json === true });
          Deno.exit(exitCode);
        }),
    );
}

export function buildMigrateCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMigrateCommand> {
  return createMigrateCommand(runtime);
}
