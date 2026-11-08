/**
 * @module ExaCtlApprovalCommand
 * @path apps/exactl/src/command_builders/approval_command.ts
 * @description Builds the exactl approval command tree: list every pending human decision, show and decide wait states and tool confirmations.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/approval_commands.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IDisplayService } from "@exaix/core/types";
import type { IApprovalDecision } from "../commands/approval_commands.ts";
import { ExaCtlError } from "../exactl_errors.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_OPTION_APPROVAL_KIND,
  CLI_OPTION_APPROVAL_KIND_DESC,
  CLI_OPTION_REASON,
  CLI_OPTION_WAIT_MESSAGE,
  CLI_OPTION_WAIT_MESSAGE_DESC,
  CLI_OPTION_WAIT_RESOLVED_BY,
  CLI_OPTION_WAIT_RESOLVED_BY_DESC,
  CLI_OPTION_WAIT_STATUS,
  ExaCtlVerb,
} from "../exactl_constants.ts";

const EMPTY_LIST_MESSAGE = "No pending approvals.";
const ID_ARGUMENT = "<approvalId:string>";
const LIST_COLUMN_SEPARATOR = "\t";

interface IDecisionOptions {
  message?: string;
  reason?: string;
  resolvedBy?: string;
}

/** Runs one decision and reports a wait decision through the same display action as before. */
async function report(
  display: IDisplayService,
  verb: ExaCtlVerb,
  run: () => Promise<IApprovalDecision>,
): Promise<void> {
  try {
    const decision = await run();
    if (decision.waitStateId !== null) {
      display.info(`wait.${verb}`, decision.waitStateId.slice(0, 8), { status: decision.status });
    }
  } catch (error) {
    if (error instanceof ExaCtlError) throw error;
    display.error("cli.error", `approval ${verb}`, {
      message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
    });
    Deno.exit(1);
  }
}

function createApprovalCommand(runtime: IExaCtlRuntime) {
  const { approvalCommands, display } = runtime;
  return new Command()
    .description("List every pending human decision and decide wait states and tool confirmations")
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .description(
          "List pending human decisions from every source with the command that decides each. " +
            "Draft skills show only for the portal of EXA_PORTAL, and for no portal when it is unset: use 'exactl skill list --portal <alias>' for another portal",
        )
        .option(CLI_OPTION_APPROVAL_KIND, CLI_OPTION_APPROVAL_KIND_DESC)
        .option(CLI_OPTION_WAIT_STATUS, "Select wait states of another status (default: pending); lists no other kind")
        .action(async (options) => {
          const entries = await approvalCommands.list({ status: options.status, kinds: options.kind });
          if (entries.length === 0) {
            console.log(EMPTY_LIST_MESSAGE);
            return;
          }
          for (const entry of entries) {
            console.log(
              [entry.ref, entry.kind, entry.summary, entry.created_at, entry.act].join(LIST_COLUMN_SEPARATOR),
            );
          }
        }),
    )
    .command(
      `${ExaCtlVerb.SHOW} ${ID_ARGUMENT}`,
      new Command()
        .description("Show one pending approval: wait:<resume-token> or tool:<confirmation-id>")
        .action(async (_options, ...args: string[]) => {
          const detail = await approvalCommands.show(args[0]);
          console.log(`kind: ${detail.kind}`);
          for (const [key, value] of Object.entries(detail.fields)) console.log(`${key}: ${value}`);
        }),
    )
    .command(
      `${ExaCtlVerb.APPROVE} ${ID_ARGUMENT}`,
      new Command()
        .description("Approve a wait state or a tool confirmation")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(display, ExaCtlVerb.APPROVE, () => approvalCommands.approve(args[0], options));
        }),
    )
    .command(
      `${ExaCtlVerb.REJECT} ${ID_ARGUMENT}`,
      new Command()
        .description("Reject a wait state or deny a tool confirmation")
        .option(CLI_OPTION_REASON, "Why the item is rejected (a tool denial defaults to 'User declined')")
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(display, ExaCtlVerb.REJECT, () => approvalCommands.reject(args[0], options));
        }),
    )
    .command(
      `${ExaCtlVerb.AMEND} ${ID_ARGUMENT}`,
      new Command()
        .description("Mark a wait state as amended")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(display, ExaCtlVerb.AMEND, () => approvalCommands.amend(args[0], options));
        }),
    )
    .command(
      `${ExaCtlVerb.EXPIRE} ${ID_ARGUMENT}`,
      new Command()
        .description("Expire a pending wait state")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(display, ExaCtlVerb.EXPIRE, () => approvalCommands.expire(args[0], options));
        }),
    )
    .command(
      `${ExaCtlVerb.CANCEL} ${ID_ARGUMENT}`,
      new Command()
        .description("Cancel a pending wait state")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(display, ExaCtlVerb.CANCEL, () => approvalCommands.cancel(args[0], options));
        }),
    );
}

export function buildApprovalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createApprovalCommand> {
  return createApprovalCommand(runtime);
}
