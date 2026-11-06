/**
 * @module ExaCtlMemoryCommand
 * @path apps/exactl/src/command_builders/memory_command.ts
 * @description Builds the exactl memory command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { MemoryScope, RequestOperation } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { OutputFormat } from "@exaix/cli/types/memory_types.ts";
import { selectBulkTargets } from "./bulk_targets.ts";
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_LIMIT_HELP,
  CLI_LIMIT_OPTION,
  CLI_OPTION_PORTAL,
  CLI_OPTION_REASON,
  CLI_OUTPUT_FORMAT_DEFAULT,
  CLI_OUTPUT_FORMAT_HELP,
  CLI_OUTPUT_FORMAT_OPTION,
  ExaCtlSubNoun,
  ExaCtlVerb,
} from "../exactl_constants.ts";

/** Result text that starts a failed approval. MemoryCommands reports a failure as text, not as an error. */
const FAILED_APPROVAL_PREFIXES: readonly string[] = ["Error:", "Proposal not found:"];

interface IExecutionListOptions {
  portal?: Opt<string, Reason.OptionalInput>;
  limit?: Opt<number, Reason.OptionalInput>;
  format?: Opt<string, Reason.OptionalInput>;
}

interface IPendingListOptions {
  eligible?: Opt<boolean, Reason.OptionalInput>;
  format?: Opt<string, Reason.OptionalInput>;
}

function createMemoryCommand(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  const command = new Command()
    .description("Manage Memory Banks (project memory, execution history, search)")
    .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
    .action(async (options) => {
      // Default action: show summary
      const result = await memoryCommands.list(options.format as OutputFormat);
      console.log(result);
    });
  for (
    const [name, child] of [
      ...addMemoryCommands1(runtime),
      ...addMemoryCommands2(runtime),
      ...addMemoryCommands4(runtime),
    ]
  ) command.command(name, child);
  command.command(ExaCtlSubNoun.LEARNING, createLearningCommand(runtime));
  command.command(ExaCtlSubNoun.INDEX, createIndexCommand(runtime));
  return command;
}

function addMemoryCommands1(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  return [
    [
      RequestOperation.LIST,
      new Command()
        .description("List all memory banks with summary")
        .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
        .action(async (options) => {
          const result = await memoryCommands.list(options.format as OutputFormat);
          console.log(result);
        }),
    ],
    [
      "search <query:string>",
      new Command()
        .description("Search across all memory banks")
        .option(CLI_OPTION_PORTAL, "Filter by portal")
        .option("-t, --tags <tags:string>", "Filter by tags (comma-separated)")
        .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
        .option("-e, --use-embeddings", "Use embedding-based semantic search")
        .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
        .action(async (options, ...args: string[]) => {
          const query = args[0];
          const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
          const result = await memoryCommands.search(query, {
            portal: options.portal,
            tags,
            limit: options.limit,
            format: options.format as OutputFormat,
            useEmbeddings: options.useEmbeddings,
          });
          console.log(result);
        }),
    ],
    [
      MemoryScope.PROJECT,
      new Command()
        .description("Project memory operations")
        .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
        .action(async (options) => {
          // Default: list projects
          const result = await memoryCommands.projectList(options.format as OutputFormat);
          console.log(result);
        })
        .command(
          RequestOperation.LIST,
          new Command()
            .description("List all project memories")
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .action(async (options) => {
              const result = await memoryCommands.projectList(options.format as OutputFormat);
              console.log(result);
            }),
        )
        .command(
          "show <portal:string>",
          new Command()
            .description("Show details of a specific project memory")
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .action(async (options, ...args: string[]) => {
              const portal = args[0];
              const result = await memoryCommands.projectShow(portal, options.format as OutputFormat);
              console.log(result);
            }),
        ),
    ],
  ] as const;
}

function addMemoryCommands2(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  const listExecutions = async (options: IExecutionListOptions): Promise<void> => {
    const result = await memoryCommands.executionList({
      portal: options.portal,
      limit: options.limit,
      format: options.format as OutputFormat,
    });
    console.log(result);
  };
  return [
    [
      "execution",
      new Command()
        .description("Execution history operations")
        .option(CLI_OPTION_PORTAL, "Filter by portal")
        .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
        .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
        .action(listExecutions)
        .command(
          RequestOperation.LIST,
          new Command()
            .description("List execution history")
            .option(CLI_OPTION_PORTAL, "Filter by portal")
            .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: 20 })
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .action(listExecutions),
        )
        .command(
          "show <traceId:string>",
          new Command()
            .description("Show details of a specific execution")
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .action(async (options, ...args: string[]) => {
              const traceId = args[0];
              const result = await memoryCommands.executionShow(traceId, options.format as OutputFormat);
              console.log(result);
            }),
        ),
    ],
  ] as const;
}

function createLearningCommand(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  return new Command()
    .description("Manage global learnings")
    .command(
      `${ExaCtlVerb.REMOVE} <learningId:string>`,
      new Command()
        .description("Soft-delete a global learning (status → deleted, retained for audit)")
        .option(CLI_OPTION_REASON, "Deletion reason")
        .action(async (options, ...args: string[]) => {
          const learningId = args[0];
          const result = await memoryCommands.deleteLearning(learningId, options.reason);
          console.log(result);
        }),
    );
}

function createIndexCommand(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  return new Command()
    .description("Manage memory bank search indices")
    .command(
      ExaCtlVerb.REBUILD,
      new Command()
        .description("Rebuild memory bank search indices")
        .option("-e, --include-embeddings", "Regenerate embedding vectors for all learnings")
        .action(async (options) => {
          const result = await memoryCommands.rebuildIndex({
            includeEmbeddings: options.includeEmbeddings,
          });
          console.log(result);
        }),
    );
}

function addMemoryCommands4(runtime: IExaCtlRuntime) {
  const { memoryCommands } = runtime;
  const listPending = async (options: IPendingListOptions): Promise<void> => {
    const result = await memoryCommands.pendingList(options.eligible, options.format as OutputFormat);
    console.log(result);
  };
  return [
    [
      ExaCtlSubNoun.PROPOSAL,
      new Command()
        .description("Manage pending memory update proposals")
        .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
        .option("--eligible", "Show only auto-approval eligible pending proposals")
        .action(listPending)
        .command(
          RequestOperation.LIST,
          new Command()
            .description("List all pending proposals")
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .option("--eligible", "Show only auto-approval eligible pending proposals")
            .action(listPending),
        )
        .command(
          "show <proposalId:string>",
          new Command()
            .description("Show details of a pending proposal")
            .option(CLI_OUTPUT_FORMAT_OPTION, CLI_OUTPUT_FORMAT_HELP, CLI_OUTPUT_FORMAT_DEFAULT)
            .action(async (options, ...args: string[]) => {
              const proposalId = args[0];
              const result = await memoryCommands.pendingShow(proposalId, options.format as OutputFormat);
              console.log(result);
            }),
        )
        .command(
          "approve [proposalIds...:string]",
          new Command()
            .description("Approve pending proposals or preview auto-approvals")
            .option("--all", "Approve every pending proposal")
            .option("--dry-run", "Preview auto-approvable proposals without changing state")
            .action(async (options, ...ids: string[]) => {
              if (options.dryRun) {
                if (ids.length > 0 || options.all) {
                  throw new ExaCtlError(ExaCtlExitCode.USAGE, "--dry-run takes no proposal id. Use it alone.");
                }
                console.log(await memoryCommands.pendingApprove(undefined, true));
                return;
              }
              const targets = selectBulkTargets(ids, options.all === true, "proposal");
              if (targets.all) {
                console.log(await memoryCommands.pendingApproveAll());
                return;
              }
              for (const proposalId of targets.ids) {
                const result = await memoryCommands.pendingApprove(proposalId, false);
                console.log(result);
                if (FAILED_APPROVAL_PREFIXES.some((prefix) => result.startsWith(prefix))) break;
              }
            }),
        )
        .command(
          "reject <proposalId:string>",
          new Command()
            .description("Reject a pending proposal")
            .option(CLI_OPTION_REASON, "Rejection reason", { required: true })
            .action(async (options, ...args: string[]) => {
              const proposalId = args[0];
              const result = await memoryCommands.pendingReject(proposalId, options.reason);
              console.log(result);
            }),
        ),
    ],
  ] as const;
}

export function buildMemoryCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMemoryCommand> {
  return createMemoryCommand(runtime);
}
