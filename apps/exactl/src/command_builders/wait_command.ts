/**
 * @module ExaCtlWaitCommand
 * @path apps/exactl/src/command_builders/wait_command.ts
 * @description Builds the exactl wait command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_CMD_LIST,
  CLI_OPTION_WAIT_MESSAGE,
  CLI_OPTION_WAIT_MESSAGE_DESC,
  CLI_OPTION_WAIT_RESOLVED_BY,
  CLI_OPTION_WAIT_RESOLVED_BY_DESC,
  CLI_OPTION_WAIT_STATUS,
} from "../exactl_constants.ts";

function createWaitCommand(runtime: IExaCtlRuntime) {
  const { display, waitStateCommands } = runtime;
  return new Command()
    .description("Manage durable wait states for human-in-the-loop approvals")
    .command(
      CLI_CMD_LIST,
      new Command()
        .description("List pending wait states")
        .option(CLI_OPTION_WAIT_STATUS, "Filter by status")
        .action(async (options) => {
          try {
            const entries = await waitStateCommands.list(options.status);
            if (entries.length === 0) {
              display.info("wait.list", null, { count: 0, message: "No wait states found" });
              return;
            }
            for (const e of entries) {
              display.info("wait.list.entry", e.waitStateId, {
                kind: e.kind,
                status: e.status,
                traceId: e.traceId,
                createdAt: e.createdAt,
              });
            }
          } catch (error) {
            display.error("cli.error", "wait list", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "approve <token>",
      new Command()
        .description("Approve a pending wait state by resume token")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options, ...args: string[]) => {
          try {
            const updated = await waitStateCommands.approve(args[0], options.message, options.resolvedBy);
            display.info("wait.approve", updated.waitStateId.slice(0, 8), { status: updated.status });
          } catch (error) {
            display.error("cli.error", "wait approve", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "reject <token>",
      new Command()
        .description("Reject a pending wait state by resume token")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options, ...args: string[]) => {
          try {
            const updated = await waitStateCommands.reject(args[0], options.message, options.resolvedBy);
            display.info("wait.reject", updated.waitStateId.slice(0, 8), { status: updated.status });
          } catch (error) {
            display.error("cli.error", "wait reject", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "amend <token>",
      new Command()
        .description("Mark a wait state as amended by resume token")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options, ...args: string[]) => {
          try {
            const updated = await waitStateCommands.amend(args[0], options.message, options.resolvedBy);
            display.info("wait.amend", updated.waitStateId.slice(0, 8), { status: updated.status });
          } catch (error) {
            display.error("cli.error", "wait amend", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "expire <token>",
      new Command()
        .description("Expire a pending wait state by resume token")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options, ...args: string[]) => {
          try {
            const updated = await waitStateCommands.expire(args[0], options.message, options.resolvedBy);
            display.info("wait.expire", updated.waitStateId.slice(0, 8), { status: updated.status });
          } catch (error) {
            display.error("cli.error", "wait expire", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "cancel <token>",
      new Command()
        .description("Cancel a pending wait state by resume token")
        .option(CLI_OPTION_WAIT_MESSAGE, CLI_OPTION_WAIT_MESSAGE_DESC)
        .option(CLI_OPTION_WAIT_RESOLVED_BY, CLI_OPTION_WAIT_RESOLVED_BY_DESC)
        .action(async (options, ...args: string[]) => {
          try {
            const updated = await waitStateCommands.cancel(args[0], options.message, options.resolvedBy);
            display.info("wait.cancel", updated.waitStateId.slice(0, 8), { status: updated.status });
          } catch (error) {
            display.error("cli.error", "wait cancel", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

export function buildWaitCommand(runtime: IExaCtlRuntime): ReturnType<typeof createWaitCommand> {
  return createWaitCommand(runtime);
}
