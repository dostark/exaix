/**
 * @module ExaCtlDoctorCommand
 * @path apps/exactl/src/command_builders/doctor_command.ts
 * @description Builds the exactl doctor command. It runs the health checks and turns the first failing check into the exit code.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli]
 * @related-files [apps/exactl/src/commands/doctor_commands.ts, apps/exactl/src/exactl.ts]
 */

import { Command } from "@cliffy/command";
import { documented, ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { ExaCtlError } from "@exaix/cli/errors/exactl_errors.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName } from "../exactl_constants.ts";
import { commandDocFor } from "../command_docs/mod.ts";
import { actionOutput, type IJsonRow, toRow } from "../output/exactl_output.ts";
import { DoctorCommands, doctorExitCode, DoctorStatus, type IDoctorSources } from "../commands/doctor_commands.ts";
import { createProvider } from "../init.ts";

const FALLBACK_MODEL = "mock:test";

const CHECK_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Check", value: (row) => String(row.name) },
  { header: "Status", value: (row) => String(row.status) },
  { header: "Message", value: (row) => String(row.message) },
];

/** The probes of the checks, taken from the commands that already own them. */
function sourcesOf(runtime: IExaCtlRuntime): IDoctorSources {
  return {
    checkMigration: () => runtime.daemonCommands.checkMigration(),
    validateConfig: () => runtime.configCommands.validate(),
    inspectPid: () => runtime.daemonCommands.inspectPid(),
    probeProvider: async () => {
      await createProvider(runtime.config, runtime.config.agents?.default_model || FALLBACK_MODEL);
    },
    listModels: () => runtime.modelCommands.listModels(),
  };
}

function createDoctorCommand(runtime: IExaCtlRuntime) {
  const command = new Command()
    .option("--schema", "Run only the schema check")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      const checks = await new DoctorCommands(sourcesOf(runtime)).run({ schema: options.schema === true });
      await renderer.list(
        checks.map((check) => toRow({ name: check.name, status: check.status, message: check.message })),
        CHECK_COLUMNS,
        (row) => String(row.name),
      );
      const failing = checks.filter((check) => check.status === DoctorStatus.FAIL).length;
      if (failing > 0) throw new ExaCtlError(doctorExitCode(checks), `${failing} check(s) failed.`);
    });
  return documented(command, commandDocFor([ExaCtlCommandName.DOCTOR]), []);
}

export function buildDoctorCommand(runtime: IExaCtlRuntime): ReturnType<typeof createDoctorCommand> {
  return createDoctorCommand(runtime);
}
