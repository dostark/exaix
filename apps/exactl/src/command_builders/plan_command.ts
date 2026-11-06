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
import { CLI_CMD_LIST, CLI_CMD_SHOW_ID, CLI_OPTION_REASON } from "../exactl_constants.ts";

function createPlanCommand(runtime: IExaCtlRuntime) {
  const command = new Command()
    .description("Manage AI-generated plans");
  for (const [name, child] of [...addPlanCommands1(runtime), ...addPlanCommands2(runtime)]) {
    command.command(name, child);
  }
  return command;
}

function addPlanCommands1(runtime: IExaCtlRuntime) {
  const { display, planCommands } = runtime;
  return [
    [
      RequestOperation.LIST,
      new Command()
        .description("List all plans awaiting review")
        .option("-s, --status <status:string>", "Filter by status (review, needs_revision)")
        .action(async (options) => {
          await handlePlanList({ planCommands, display }, options as IPlanListOptions);
        }),
    ],
    [
      CLI_CMD_SHOW_ID,
      new Command()
        .description("Show details of a specific plan")
        .action(async (_options, ...args: string[]) => {
          await handlePlanShow({ planCommands, display }, args[0] as string);
        }),
    ],
    [
      "approve [ids...:string]",
      new Command()
        .description("Approve plans and move them to Workspace/Active")
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
        .description("Reject a plan with a reason")
        .option(CLI_OPTION_REASON, "Rejection reason (required)", { required: true })
        .action(async (options, ...args: string[]) => {
          await handlePlanReject({ planCommands, display }, args[0] as string, options.reason);
        }),
    ],
    [
      "revise <id>",
      new Command()
        .description("Request revision with review comments")
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
        .description("Manage plan amendments for paused executions")
        .command(
          CLI_CMD_LIST,
          new Command()
            .description("List plans awaiting amendment approval")
            .action(async () => {
              await handlePlanAmendmentList({ planCommands, display });
            }),
        )
        .command(
          "show [ids...:string]",
          new Command()
            .description("Show details of proposed amendments")
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
            .description("Approve amendments and resume execution")
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
            .description("Reject a proposed amendment")
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
