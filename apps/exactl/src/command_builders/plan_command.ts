/**
 * @module ExaCtlPlanCommand
 * @path apps/exactl/src/command_builders/plan_command.ts
 * @description Builds the exactl plan command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { RequestOperation } from "@exaix/core";
import {
  handlePlanAmendmentApprove,
  handlePlanAmendmentApproveAll,
  handlePlanAmendmentList,
  handlePlanAmendmentReject,
  handlePlanAmendmentShow,
  handlePlanAmendmentShowAll,
  handlePlanApprove,
  handlePlanApproveAll,
  handlePlanList,
  handlePlanReject,
  handlePlanRevise,
  handlePlanShow,
  type IPlanListOptions,
} from "./plan_actions.ts";
import { selectBulkTargets } from "./bulk_targets.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { createExaCtlRenderer, readGlobalOptions } from "../output/exactl_output.ts";
import {
  CLI_CMD_LIST,
  CLI_CMD_SHOW_ID,
  CLI_OPTION_REASON,
  ExaCtlCommandName,
  ExaCtlSubNoun,
} from "../exactl_constants.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import { PLAN_AMENDMENT_SUMMARY } from "../command_docs/plan_docs.ts";

function createPlanCommand(runtime: IExaCtlRuntime) {
  const noun = nounDocFor(ExaCtlCommandName.PLAN);
  const command = documentedNoun(new Command(), noun);
  for (const [name, child] of [...addPlanCommands1(runtime), ...addPlanCommands2(runtime)]) {
    command.command(name, child);
  }
  documentLeaves(command, [ExaCtlCommandName.PLAN], noun.lifecycle);
  const amendment = command.getCommand(ExaCtlSubNoun.AMENDMENT);
  if (amendment !== undefined) {
    documentLeaves(amendment, [ExaCtlCommandName.PLAN, ExaCtlSubNoun.AMENDMENT], noun.lifecycle);
  }
  return command;
}

function addPlanCommands1(runtime: IExaCtlRuntime) {
  const { display, planCommands, outputSink } = runtime;
  return [
    [
      RequestOperation.LIST,
      new Command()
        .option("-s, --status <status:string>", "Filter by status (review, needs_revision)")
        .action(async (options) => {
          const renderer = createExaCtlRenderer(readGlobalOptions(options), ExaCtlOutputFormat.TABLE, outputSink);
          await handlePlanList({ planCommands, display }, options as IPlanListOptions, renderer);
        }),
    ],
    [
      CLI_CMD_SHOW_ID,
      new Command()
        .action(async (_options, ...args: string[]) => {
          await handlePlanShow({ planCommands, display }, args[0] as string);
        }),
    ],
    [
      "approve [ids...:string]",
      new Command()
        .option("--all", "Approve every plan awaiting review")
        .action(async (options, ...ids: string[]) => {
          const targets = selectBulkTargets(ids, options.all === true, "plan");
          if (targets.all) {
            await handlePlanApproveAll({ planCommands, display });
          } else {
            await handlePlanApprove({ planCommands, display }, targets.ids);
          }
        }),
    ],
    [
      "reject <id>",
      new Command()
        .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
        .action(async (options, ...args: string[]) => {
          await handlePlanReject({ planCommands, display }, args[0] as string, options.reason);
        }),
    ],
    [
      "revise <id>",
      new Command()
        .option("-c, --comment <comment:string>", "Review comment (can be specified multiple times)", {
          collect: true,
          required: true,
        })
        .action(async (options, ...args: string[]) => {
          await handlePlanRevise({ planCommands, display }, args[0] as string, options.comment);
        }),
    ],
  ] as const;
}

function addPlanCommands2(runtime: IExaCtlRuntime) {
  const { display, planCommands } = runtime;
  return [
    [
      "amendment",
      new Command()
        .description(PLAN_AMENDMENT_SUMMARY)
        .command(
          CLI_CMD_LIST,
          new Command()
            .action(async () => {
              await handlePlanAmendmentList({ planCommands, display });
            }),
        )
        .command(
          "show [ids...:string]",
          new Command()
            .option("--all", "Show every proposed amendment")
            .action(async (options, ...ids: string[]) => {
              const targets = selectBulkTargets(ids, options.all === true, "amendment");
              if (targets.all) {
                await handlePlanAmendmentShowAll({ planCommands, display });
              } else {
                await handlePlanAmendmentShow({ planCommands, display }, targets.ids);
              }
            }),
        )
        .command(
          "approve [ids...:string]",
          new Command()
            .option("--all", "Approve every pending amendment")
            .action(async (options, ...ids: string[]) => {
              const targets = selectBulkTargets(ids, options.all === true, "amendment");
              if (targets.all) {
                await handlePlanAmendmentApproveAll({ planCommands, display });
              } else {
                await handlePlanAmendmentApprove({ planCommands, display }, targets.ids);
              }
            }),
        )
        .command(
          "reject <id>",
          new Command()
            .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
            .action(async (options, ...args: string[]) => {
              await handlePlanAmendmentReject({ planCommands, display }, args[0] as string, options.reason);
            }),
        ),
    ],
  ] as const;
}

export function buildPlanCommand(runtime: IExaCtlRuntime): ReturnType<typeof createPlanCommand> {
  return createPlanCommand(runtime);
}
