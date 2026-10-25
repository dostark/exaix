/**
 * @module UnslopBudget
 * @path packages/execution/src/unslop_budget.ts
 * @description Shares one deadline and captured Git byte budget across a verification invocation.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/git, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts, packages/execution/tests/unslop_check_runner_test.ts]
 */

import type { IGitCommandOptions, IGitService, Opt, Reason } from "@exaix/core/types";
import { GitOutputLimitError } from "@exaix/git";
import { UnslopErrorClass } from "@exaix/schemas";
import type { IUnslopCheckContext } from "./unslop_check_types.ts";
import { UnslopCheckError } from "./unslop_check_error.ts";

/** Invocation-local mutable counters, never shared between checks. */
interface IUnslopBudget {
  readonly deadline: number;
  gitBytes: number;
}

function remainingMs(budget: IUnslopBudget): number {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) throw new UnslopCheckError(UnslopErrorClass.TIMEOUT);
  return remaining;
}

/** Binds every query and timeout read to the same invocation budget. */
export function bindUnslopBudget(context: IUnslopCheckContext, gitMaxBytes: number): IUnslopCheckContext {
  const budget: IUnslopBudget = { deadline: Date.now() + context.timeoutMs, gitBytes: gitMaxBytes };
  const run = context.git.runGitCommand.bind(context.git);
  const bounded: IGitService["runGitCommand"] = async (
    args: string[],
    options: Opt<IGitCommandOptions, Reason.OptionalContext> = {},
  ) => {
    if (budget.gitBytes <= 0) throw new GitOutputLimitError("Verification Git budget exceeded");
    const result = await run(args, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? remainingMs(budget), remainingMs(budget)),
      maxOutputBytes: Math.min(options.maxOutputBytes ?? budget.gitBytes, budget.gitBytes),
      retryOnLock: false,
    });
    budget.gitBytes -= result.capturedBytes ?? result.stdoutBytes?.byteLength ??
      new TextEncoder().encode(result.output).byteLength;
    remainingMs(budget);
    return result;
  };
  const git = new Proxy(context.git, {
    get(target, property) {
      if (property === "runGitCommand") return bounded;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    ...context,
    git,
    get timeoutMs() {
      return remainingMs(budget);
    },
  };
}
