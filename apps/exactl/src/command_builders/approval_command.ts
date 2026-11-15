/**
 * @module ExaCtlApprovalCommand
 * @path apps/exactl/src/command_builders/approval_command.ts
 * @description Builds the exactl approval command tree: list every pending human decision, show and decide wait states and tool confirmations.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/approval_commands.ts]
 */

import { confirmAction, type IConfirmRuntime } from "../output/exactl_confirm.ts";
import { toExaCtlError } from "./command_failure.ts";
import { Command } from "@cliffy/command";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import type { IDisplayService } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn, type IExaCtlOutputSink } from "@exaix/cli";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  type ExaCtlOutputRenderer,
  type IJsonRow,
  toRow,
} from "../output/exactl_output.ts";
import type { ApprovalCommands, IApprovalDecision } from "../commands/approval_commands.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import {
  CLI_OPTION_APPROVAL_KIND,
  CLI_OPTION_APPROVAL_KIND_DESC,
  CLI_OPTION_REASON,
  CLI_OPTION_WAIT_MESSAGE,
  CLI_OPTION_WAIT_MESSAGE_DESC,
  CLI_OPTION_WAIT_RESOLVED_BY,
  CLI_OPTION_WAIT_RESOLVED_BY_DESC,
  CLI_OPTION_WAIT_STATUS,
  ExaCtlCommandName,
  ExaCtlVerb,
} from "../exactl_constants.ts";

// unslop-ignore-next-line unused-type
/** What the approval command tree reads from the runtime. */
export interface IApprovalCommandRuntime {
  readonly approvalCommands: ApprovalCommands;
  readonly display: IDisplayService;
  readonly outputSink: IExaCtlOutputSink;
  readonly services: IConfirmRuntime["services"];
}

const ID_ARGUMENT = "<approval-id:string>";

const APPROVAL_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Ref", value: (entry) => cellText(entry.ref) },
  { header: ColumnHeader.KIND, value: (entry) => cellText(entry.kind) },
  { header: ColumnHeader.SUMMARY, value: (entry) => cellText(entry.summary) },
  { header: ColumnHeader.CREATED, value: (entry) => cellText(entry.created_at) },
  { header: "Decide with", value: (entry) => cellText(entry.act) },
];

const APPROVAL_DETAIL_FIELDS: readonly IExaCtlColumn<IJsonRow>[] = [{
  header: ColumnHeader.KIND,
  value: (detail) => cellText(detail.kind),
}];

interface IDecisionOptions {
  message?: string;
  reason?: string;
  resolvedBy?: string;
}

/** Runs one decision and reports a wait decision through the same display action as before. */
async function report(
  output: { display: IDisplayService; renderer: ExaCtlOutputRenderer },
  verb: ExaCtlVerb,
  ref: string,
  run: () => Promise<IApprovalDecision>,
): Promise<void> {
  const { display, renderer } = output;
  try {
    const decision = await run();
    if (decision.waitStateId !== null) {
      display.info(`wait.${verb}`, decision.waitStateId.slice(0, 8), { status: decision.status });
    } else {
      display.info(`tool.${verb}`, decision.id, { status: decision.status });
    }
    await renderer.mutation([{ id: ref, action: verb, status: decision.status }], false);
  } catch (error) {
    if (error instanceof ExaCtlError) throw error;
    throw toExaCtlError(error);
  }
}

/** A decision verb that takes an optional message and the actor that decides. */
function decisionCommand(
  runtime: IApprovalCommandRuntime,
  verb: ExaCtlVerb,
  decide: (ref: string, options: IDecisionOptions) => Promise<IApprovalDecision>,
) {
  return new Command()
    .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
    .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
    .action(async (options: IDecisionOptions, ...args: string[]) => {
      if (verb === ExaCtlVerb.CANCEL) {
        const { fields } = await runtime.approvalCommands.show(args[0]);
        await confirmAction(runtime, "approval cancel", `Cancel approval ${args[0]}?`, options, fields.traceId);
      }
      await report(
        actionOutput(runtime, options, ExaCtlOutputFormat.TEXT),
        verb,
        args[0],
        () => decide(args[0], options),
      );
    });
}

function createApprovalCommand(runtime: IApprovalCommandRuntime) {
  const { approvalCommands } = runtime;
  const noun = nounDocFor(ExaCtlCommandName.APPROVAL);
  const command = documentedNoun(new Command(), noun)
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .option(CLI_OPTION_APPROVAL_KIND, CLI_OPTION_APPROVAL_KIND_DESC)
        .option(CLI_OPTION_WAIT_STATUS, "Select wait states of another status (default: pending); lists no other kind")
        .action(async (options) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          const entries = await approvalCommands.list({ status: options.status, kinds: options.kind });
          await renderer.list(entries.map(toRow), APPROVAL_COLUMNS, (entry) => cellText(entry.ref));
        }),
    )
    .command(
      `${ExaCtlVerb.SHOW} ${ID_ARGUMENT}`,
      new Command()
        .action(async (options, ...args: string[]) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          const detail = await approvalCommands.show(args[0]);
          const fields = Object.entries(detail.fields).map(([key, value]): IExaCtlColumn<IJsonRow> => ({
            header: key,
            value: () => String(value),
          }));
          await renderer.item(toRow(detail), [...APPROVAL_DETAIL_FIELDS, ...fields]);
        }),
    )
    .command(
      `${ExaCtlVerb.APPROVE} ${ID_ARGUMENT}`,
      decisionCommand(runtime, ExaCtlVerb.APPROVE, (ref, options) => approvalCommands.approve(ref, options)),
    )
    .command(
      `${ExaCtlVerb.REJECT} ${ID_ARGUMENT}`,
      new Command()
        .option(CLI_OPTION_REASON, "Why the item is rejected (a tool denial defaults to 'User declined')")
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options: IDecisionOptions, ...args: string[]) => {
          await report(
            actionOutput(runtime, options, ExaCtlOutputFormat.TEXT),
            ExaCtlVerb.REJECT,
            args[0],
            () => approvalCommands.reject(args[0], options),
          );
        }),
    )
    .command(
      `${ExaCtlVerb.AMEND} ${ID_ARGUMENT}`,
      decisionCommand(runtime, ExaCtlVerb.AMEND, (ref, options) => approvalCommands.amend(ref, options)),
    )
    .command(
      `${ExaCtlVerb.EXPIRE} ${ID_ARGUMENT}`,
      decisionCommand(runtime, ExaCtlVerb.EXPIRE, (ref, options) => approvalCommands.expire(ref, options)),
    )
    .command(
      `${ExaCtlVerb.CANCEL} ${ID_ARGUMENT}`,
      decisionCommand(runtime, ExaCtlVerb.CANCEL, (ref, options) => approvalCommands.cancel(ref, options)),
    );
  documentLeaves(command, [ExaCtlCommandName.APPROVAL], noun.lifecycle);
  return command;
}

export function buildApprovalCommand(runtime: IApprovalCommandRuntime): ReturnType<typeof createApprovalCommand> {
  return createApprovalCommand(runtime);
}

/** Ends the process when a source of `approval list` timed out. That source may still run and keep the process alive. */
export function exitWhenSourceTimedOut(
  approvalCommands: { readonly sourceTimedOut: boolean },
  exit: (code: number) => never,
): void {
  if (approvalCommands.sourceTimedOut) exit(ExaCtlExitCode.OK);
}
