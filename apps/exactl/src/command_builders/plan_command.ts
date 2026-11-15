/**
 * @module ExaCtlPlanCommand
 * @path apps/exactl/src/command_builders/plan_command.ts
 * @description Builds the exactl plan command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { confirmAction } from "../output/exactl_confirm.ts";
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
  type IPlanActionContext,
  type IPlanListOptions,
} from "./plan_actions.ts";
import { selectBulkTargets } from "./bulk_targets.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { actionOutput } from "../output/exactl_output.ts";
import { CLI_CMD_LIST, CLI_OPTION_REASON, ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import { PLAN_AMENDMENT_SUMMARY } from "../command_docs/plan_docs.ts";

const PLAN_ID_ARGUMENT = "<plan-id>";

function planContext(runtime: IExaCtlRuntime, options: object | void, format: ExaCtlOutputFormat): IPlanActionContext {
  const { renderer, display } = actionOutput(runtime, options, format);
  return { planCommands: runtime.planCommands, display, renderer };
}

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
  return [
    [
      RequestOperation.LIST,
      new Command()
        .option("-s, --status <status:string>", "Filter by status (review, needs_revision)")
        .action(async (options) => {
          await handlePlanList(planContext(runtime, options, ExaCtlOutputFormat.TABLE), options as IPlanListOptions);
        }),
    ],
    [
      `${ExaCtlVerb.SHOW} ${PLAN_ID_ARGUMENT}`,
      new Command()
        .action(async (options, ...args: string[]) => {
          await handlePlanShow(planContext(runtime, options, ExaCtlOutputFormat.TEXT), args[0] as string);
        }),
    ],
    [
      "approve [ids...:string]",
      new Command()
        .option("--all", "Approve every plan awaiting review")
        .action(async (options, ...ids: string[]) => {
          const targets = selectBulkTargets(ids, options.all === true, "plan");
          if (targets.all) {
            await confirmAction(runtime, "plan approve --all", "Approve every plan in review?", options);
            await handlePlanApproveAll(planContext(runtime, options, ExaCtlOutputFormat.TEXT));
          } else {
            await handlePlanApprove(planContext(runtime, options, ExaCtlOutputFormat.TEXT), targets.ids);
          }
        }),
    ],
    [
      `${ExaCtlVerb.REJECT} ${PLAN_ID_ARGUMENT}`,
      new Command()
        .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
        .action(async (options, ...args: string[]) => {
          await handlePlanReject(
            planContext(runtime, options, ExaCtlOutputFormat.TEXT),
            args[0] as string,
            options.reason,
          );
        }),
    ],
    [
      `${ExaCtlVerb.REVISE} ${PLAN_ID_ARGUMENT}`,
      new Command()
        .option("--comment <comment:string>", "Review comment (can be specified multiple times)", {
          collect: true,
          required: true,
        })
        .action(async (options, ...args: string[]) => {
          await handlePlanRevise(
            planContext(runtime, options, ExaCtlOutputFormat.TEXT),
            args[0] as string,
            options.comment,
          );
        }),
    ],
  ] as const;
}

function addPlanCommands2(runtime: IExaCtlRuntime) {
  return [
    [
      "amendment",
      new Command()
        .description(PLAN_AMENDMENT_SUMMARY)
        .command(
          CLI_CMD_LIST,
          new Command()
            .action(async (options) => {
              await handlePlanAmendmentList(planContext(runtime, options, ExaCtlOutputFormat.TABLE));
            }),
        )
        .command(
          "show [ids...:string]",
          new Command()
            .option("--all", "Show every proposed amendment")
            .action(async (options, ...ids: string[]) => {
              const targets = selectBulkTargets(ids, options.all === true, "amendment");
              if (targets.all) {
                await handlePlanAmendmentShowAll(planContext(runtime, options, ExaCtlOutputFormat.TEXT));
              } else {
                await handlePlanAmendmentShow(planContext(runtime, options, ExaCtlOutputFormat.TEXT), targets.ids);
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
                await confirmAction(
                  runtime,
                  "plan amendment approve --all",
                  "Approve every pending amendment?",
                  options,
                );
                await handlePlanAmendmentApproveAll(planContext(runtime, options, ExaCtlOutputFormat.TEXT));
              } else {
                await handlePlanAmendmentApprove(planContext(runtime, options, ExaCtlOutputFormat.TEXT), targets.ids);
              }
            }),
        )
        .command(
          `${ExaCtlVerb.REJECT} ${PLAN_ID_ARGUMENT}`,
          new Command()
            .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
            .action(async (options, ...args: string[]) => {
              await handlePlanAmendmentReject(
                planContext(runtime, options, ExaCtlOutputFormat.TEXT),
                args[0] as string,
                options.reason,
              );
            }),
        ),
    ],
  ] as const;
}

export function buildPlanCommand(runtime: IExaCtlRuntime): ReturnType<typeof createPlanCommand> {
  return createPlanCommand(runtime);
}
