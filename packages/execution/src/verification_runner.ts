/**
 * @module VerificationRunner
 * @path packages/execution/src/verification_runner.ts
 * @description Runs a portal's operator-configured post-execution checks in the
 *   execution worktree. Spawns through the middleware-free runDenoTask so check
 *   output never enters the registry journal. Emits the verification lifecycle
 *   events on the request trace.
 * @architectural-layer Services
 * @dependencies ["@exaix/core", "@exaix/schemas", "@exaix/tool-runtime"]
 * @related-files ["packages/execution/src/execution_loop.ts", "packages/tool-runtime/src/deno_task_runner.ts"]
 */

import { join, SEPARATOR } from "@std/path";
import { VERIFICATION_FMT_CHECK_FLAG, VERIFICATION_OUTPUT_REDACTION_MARGIN_CHARS } from "@exaix/core";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import { completeCheckStates } from "./unslop_snapshot.ts";
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";
import { UNSLOP_CHECK_KIND } from "@exaix/core";
import { checkName, denoTaskOf, isDenoTaskCheck, VerificationStatus } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import type { JSONValue, LogMetadata } from "@exaix/core/types";
import type { IGitService } from "@exaix/core/types";
import type {
  IPortalVerification,
  IVerificationCheckFailure,
  IVerificationCheckRunState,
  IVerificationLintFinding,
  IVerificationResult,
} from "@exaix/schemas";
import type { IUnslopCheckContext, IUnslopCheckOutcome } from "./unslop_check_types.ts";
import { runDenoTask } from "@exaix/tool-runtime";

/** The scoped Git and run identity of one unslop attempt. */
export interface IVerificationUnslopContext {
  runId: string;
  baseSha: string;
  targetSha: string;
  git: IGitService;
}

/** Inputs for one verification run. */
export interface IVerificationRunContext {
  requestId: string;
  traceId: string;
  attempt: number;
  executionRoot: string;
  /** Required when the block contains an unslop check. */
  unslop?: IVerificationUnslopContext;
}

/** The adapter contract the runner dispatches an unslop check to. */
export interface IUnslopCheckExecutor {
  run(context: IUnslopCheckContext): Promise<IUnslopCheckOutcome>;
}

/** Optional runners of non-Deno check kinds. */
export interface IVerificationRunnerOptions {
  /** Required when a block contains an unslop check. */
  unslop?: IUnslopCheckExecutor;
}

/** Runs a portal verification block against one execution worktree. */
export interface IVerificationRunner {
  run(config: IPortalVerification, context: IVerificationRunContext): Promise<IVerificationResult>;
}

/** True when the real path of `resolved` lies at or under the real worktree path. */
async function isConfined(executionRoot: string, resolved: string): Promise<boolean> {
  try {
    const rootReal = await Deno.realPath(executionRoot);
    const resolvedReal = await Deno.realPath(resolved);
    return resolvedReal === rootReal || resolvedReal.startsWith(rootReal + SEPARATOR);
  } catch {
    return false;
  }
}

/** @visible */
export class VerificationRunner implements IVerificationRunner {
  constructor(
    private readonly logger: IEventLogger,
    private readonly knownSecrets: readonly string[],
    private readonly options: IVerificationRunnerOptions = {},
  ) {}

  async run(config: IPortalVerification, context: IVerificationRunContext): Promise<IVerificationResult> {
    const failures: IVerificationCheckFailure[] = [];
    const lintChecks: IVerificationCheckRunState[] = [];
    const lintFindings: IVerificationLintFinding[] = [];
    const unslopIndexes = config.checks.flatMap((check, index) => check.kind === UNSLOP_CHECK_KIND ? [index] : []);
    let hadError = false;

    await this.emit(DomainEventType.ExecutionVerificationStarted, context, {
      request_id: context.requestId,
      attempt: context.attempt,
      checks: config.checks.map(checkName),
    });

    const { env, clearEnv } = this.buildCheckEnv();

    for (const [checkIndex, check] of config.checks.entries()) {
      if (check.kind === UNSLOP_CHECK_KIND) {
        const outcome = await this.runUnslopCheck(checkIndex, check, config, context);
        if (outcome.kind === VerificationStatus.PASSED) {
          lintChecks.push({ check_index: checkIndex, outcome: VerificationStatus.PASSED, total: 0, error_class: null });
          continue;
        }
        if (outcome.kind === VerificationStatus.FAILED) {
          lintChecks.push({
            check_index: checkIndex,
            outcome: VerificationStatus.FAILED,
            total: outcome.total,
            error_class: null,
          });
          for (const finding of outcome.findings) {
            lintFindings.push({
              check_index: checkIndex,
              file: finding.file,
              line: finding.start_line,
              rule: finding.rule,
            });
          }
          failures.push({ check: UNSLOP_CHECK_KIND, exit_code: 1, output: outcome.output });
          continue;
        }
        lintChecks.push({
          check_index: checkIndex,
          outcome: VerificationStatus.ERROR,
          total: null,
          error_class: outcome.error_class,
        });
        failures.push({ check: UNSLOP_CHECK_KIND, exit_code: null, output: outcome.output });
        hadError = true;
        break;
      }

      if (!isDenoTaskCheck(check)) {
        // Fail closed until the generic lint executor dispatches this kind.
        failures.push({ check: checkName(check), exit_code: null, output: "" });
        hadError = true;
        break;
      }

      const resolved = join(context.executionRoot, check.path);

      if (!(await isConfined(context.executionRoot, resolved))) {
        failures.push({ check: checkName(check), exit_code: null, output: "" });
        hadError = true;
        break;
      }

      const args = check.task === "fmt" && !check.args.includes(VERIFICATION_FMT_CHECK_FLAG)
        ? [VERIFICATION_FMT_CHECK_FLAG, ...check.args]
        : check.args;

      const outcome = await runDenoTask({
        task: check.task,
        args,
        absPath: resolved,
        cwd: context.executionRoot,
        timeoutMs: config.check_timeout_ms,
        env,
        clearEnv,
        maxOutputChars: config.output_max_chars + VERIFICATION_OUTPUT_REDACTION_MARGIN_CHARS,
      });

      if (outcome.kind === "exited") {
        if (outcome.code === 0) continue;
        failures.push({
          check: checkName(check),
          exit_code: outcome.code,
          output: this.prepareOutput(outcome.stdout + outcome.stderr, config.output_max_chars),
        });
        continue;
      }

      failures.push({ check: checkName(check), exit_code: null, output: "" });
      hadError = true;
      break;
    }

    const lintState = {
      ...(context.unslop === undefined ? {} : { run_id: context.unslop.runId }),
      lint_checks: completeCheckStates(lintChecks, unslopIndexes),
      lint_findings: lintFindings,
    };
    if (failures.length === 0) {
      await this.emit(DomainEventType.ExecutionVerificationPassed, context, {
        request_id: context.requestId,
        attempt: context.attempt,
      });
      return { passed: true, error: false, failures: [], ...lintState };
    }

    const failedChecks: JSONValue[] = failures.map((failure) => {
      const task = denoTaskOf(failure.check);
      return { check: failure.check, ...(task === null ? {} : { task }), exit_code: failure.exit_code };
    });
    await this.emit(DomainEventType.ExecutionVerificationFailed, context, {
      request_id: context.requestId,
      attempt: context.attempt,
      failed_checks: failedChecks,
    });

    return { passed: false, error: hadError, failures, ...lintState };
  }

  /** Dispatches one unslop check to the adapter. A missing adapter or scope is a categorical error. */
  private async runUnslopCheck(
    checkIndex: number,
    check: Extract<IPortalVerification["checks"][number], { kind: "unslop" }>,
    config: IPortalVerification,
    context: IVerificationRunContext,
  ): Promise<IUnslopCheckOutcome> {
    const adapter = this.options.unslop;
    const bound = context.unslop;
    if (adapter === undefined || bound === undefined) {
      return {
        kind: VerificationStatus.ERROR,
        error_class: "UnslopHostProtocolInvalid",
        total: null,
        findings: [],
        output: "",
      };
    }
    return await adapter.run({
      requestId: context.requestId,
      traceId: context.traceId,
      attempt: context.attempt,
      executionRoot: context.executionRoot,
      runId: bound.runId,
      baseSha: bound.baseSha,
      targetSha: bound.targetSha,
      git: bound.git,
      checkIndex,
      check: { kind: "unslop", packs: check.packs, catalog: check.catalog, include: check.include },
      timeoutMs: config.check_timeout_ms,
      outputMaxChars: config.output_max_chars,
    });
  }

  /** Build the allowlist child env plus only the deno cache keys from the daemon env. */
  private buildCheckEnv(): { env: Record<string, string>; clearEnv: boolean } {
    return buildVerificationCheckEnv();
  }

  /** Sanitize, redact known secrets, then keep only the last `maxChars` characters. */
  private prepareOutput(output: string, maxChars: number): string {
    return prepareVerificationOutput(output, maxChars, this.knownSecrets);
  }

  private emit(action: TDomainEventType, context: IVerificationRunContext, payload: LogMetadata): Promise<void> {
    return this.logger.info(action, null, payload, context.traceId);
  }
}
