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
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";
import { checkName, denoTaskOf } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import type { JSONValue, LogMetadata } from "@exaix/core/types";
import type { IPortalVerification, IVerificationCheckFailure, IVerificationResult } from "@exaix/schemas";
import { runDenoTask } from "@exaix/tool-runtime";

/** Inputs for one verification run. */
export interface IVerificationRunContext {
  requestId: string;
  traceId: string;
  attempt: number;
  executionRoot: string;
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
  ) {}

  async run(config: IPortalVerification, context: IVerificationRunContext): Promise<IVerificationResult> {
    const failures: IVerificationCheckFailure[] = [];
    let hadError = false;

    await this.emit(DomainEventType.ExecutionVerificationStarted, context, {
      request_id: context.requestId,
      attempt: context.attempt,
      checks: config.checks.map(checkName),
    });

    const { env, clearEnv } = this.buildCheckEnv();

    for (const check of config.checks) {
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

    if (failures.length === 0) {
      await this.emit(DomainEventType.ExecutionVerificationPassed, context, {
        request_id: context.requestId,
        attempt: context.attempt,
      });
      return { passed: true, error: false, failures: [] };
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

    return { passed: false, error: hadError, failures };
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
