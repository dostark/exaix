/**
 * @module DoctorCommands
 * @path apps/exactl/src/commands/doctor_commands.ts
 * @description Runs the read-only health checks of exactl: schema, config, daemon, provider and pricing. It reuses existing probes and never changes state.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, @exaix/core]
 * @related-files [apps/exactl/src/command_builders/doctor_command.ts, apps/exactl/src/commands/daemon_commands.ts, apps/exactl/src/commands/model_commands.ts]
 */

import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import type { IConfigValidationReport } from "@exaix/core/config";
import { DaemonPidState, type IDaemonPidInspection, type IMigrationCheck } from "./daemon_commands.ts";
import { type IModelListRow, ROUTES_WITHOUT_PRICE } from "./model_commands.ts";

export enum DoctorCheckName {
  SCHEMA = "schema",
  CONFIG = "config",
  DAEMON = "daemon",
  PROVIDER = "provider",
  PRICING = "pricing",
}

export enum DoctorStatus {
  PASS = "PASS",
  WARN = "WARN",
  FAIL = "FAIL",
}

/** One check result. The exit code is the class of a failure and OK for a pass or a warning. */
export interface IDoctorCheck {
  name: DoctorCheckName;
  status: DoctorStatus;
  message: string;
  exitCode: ExaCtlExitCode;
}

/** The existing probes that the checks read. A test replaces each one. */
export interface IDoctorSources {
  checkMigration(): IMigrationCheck;
  validateConfig(): Promise<IConfigValidationReport>;
  inspectPid(): Promise<IDaemonPidInspection>;
  /** Builds the default provider. It throws when the provider cannot start. */
  probeProvider(): Promise<void>;
  listModels(): Promise<IModelListRow[]>;
}

export interface IDoctorOptions {
  /** Runs only the schema check. */
  schema: boolean;
}

const CREDENTIAL_MARKERS: readonly string[] = ["not found in environment or credential store", "Missing credential"];
const PRICE_EXEMPT_SERVICE = "mock";
const NO_PRICE = "no price";
const STALE_PRICE = "price older than the staleness limit";

function check(
  name: DoctorCheckName,
  status: DoctorStatus,
  message: string,
  exitCode = ExaCtlExitCode.OK,
): IDoctorCheck {
  return { name, status, message, exitCode };
}

/** The first failing check decides the exit code. A warning never fails. */
export function doctorExitCode(checks: readonly IDoctorCheck[]): ExaCtlExitCode {
  return checks.find((candidate) => candidate.status === DoctorStatus.FAIL)?.exitCode ?? ExaCtlExitCode.OK;
}

function priceProblem(row: IModelListRow): string | null {
  if (row.service === PRICE_EXEMPT_SERVICE || ROUTES_WITHOUT_PRICE.has(row.route)) return null;
  if (row.input_per_mtok === null || row.output_per_mtok === null) return NO_PRICE;
  return row.stale === true ? STALE_PRICE : null;
}

export class DoctorCommands {
  constructor(private readonly sources: IDoctorSources) {}

  /** Runs the checks in a fixed order. `--schema` runs the first one only. */
  async run(options: IDoctorOptions): Promise<IDoctorCheck[]> {
    const schema = this.schema();
    if (options.schema) return [schema];
    return [schema, await this.config(), await this.daemon(), await this.provider(), await this.pricing()];
  }

  private schema(): IDoctorCheck {
    const result = this.sources.checkMigration();
    return result.exitCode === 0
      ? check(DoctorCheckName.SCHEMA, DoctorStatus.PASS, result.message)
      : check(DoctorCheckName.SCHEMA, DoctorStatus.FAIL, result.message, ExaCtlExitCode.INVALID);
  }

  private async config(): Promise<IDoctorCheck> {
    const report = await this.sources.validateConfig();
    return report.valid ? check(DoctorCheckName.CONFIG, DoctorStatus.PASS, "The configuration is valid.") : check(
      DoctorCheckName.CONFIG,
      DoctorStatus.FAIL,
      `The configuration has ${report.issues.length} issue(s): ${report.issues.map((issue) => issue.path).join(", ")}.`,
      ExaCtlExitCode.INVALID,
    );
  }

  private async daemon(): Promise<IDoctorCheck> {
    const inspection = await this.sources.inspectPid();
    if (inspection.state === DaemonPidState.ALIVE) {
      return check(DoctorCheckName.DAEMON, DoctorStatus.PASS, `The daemon runs with pid ${inspection.pid}.`);
    }
    if (inspection.state === DaemonPidState.ABSENT) {
      return check(DoctorCheckName.DAEMON, DoctorStatus.WARN, "The daemon is stopped.");
    }
    return check(
      DoctorCheckName.DAEMON,
      DoctorStatus.FAIL,
      `The PID file names pid ${inspection.pid}, but that process is dead.`,
      ExaCtlExitCode.DAEMON_UNAVAILABLE,
    );
  }

  private async provider(): Promise<IDoctorCheck> {
    try {
      await this.sources.probeProvider();
      return check(DoctorCheckName.PROVIDER, DoctorStatus.PASS, "The default provider starts.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const credentials = CREDENTIAL_MARKERS.some((marker) => message.includes(marker));
      return check(
        DoctorCheckName.PROVIDER,
        DoctorStatus.FAIL,
        message,
        credentials ? ExaCtlExitCode.CREDENTIALS : ExaCtlExitCode.INVALID,
      );
    }
  }

  private async pricing(): Promise<IDoctorCheck> {
    const problems = (await this.sources.listModels()).flatMap((row) => {
      const problem = priceProblem(row);
      return problem === null ? [] : [`${row.model} (${problem})`];
    });
    return problems.length === 0
      ? check(DoctorCheckName.PRICING, DoctorStatus.PASS, "Every priced model has a current price.")
      : check(
        DoctorCheckName.PRICING,
        DoctorStatus.WARN,
        `Cost numbers rest on old or missing prices: ${problems.join(", ")}.`,
      );
  }
}
