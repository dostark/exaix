/**
 * @module ExaCtlMemoryCommand
 * @path apps/exactl/src/command_builders/memory_command.ts
 * @description Builds the exactl memory command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { confirmAction } from "../output/exactl_confirm.ts";
import { Command } from "@cliffy/command";
import { MemoryScope } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { selectBulkTargets } from "./bulk_targets.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_LIMIT_HELP,
  CLI_LIMIT_OPTION,
  CLI_OPTION_PORTAL_LONG,
  CLI_OPTION_REASON,
  COMMA_SEPARATOR,
  ExaCtlCommandName,
  ExaCtlSubNoun,
  ExaCtlVerb,
  MutationStatus,
} from "../exactl_constants.ts";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  type IJsonRow,
  toRow,
  TRACE_PREFIX_CHARS,
} from "../output/exactl_output.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import { numberOf } from "../output/json_narrow.ts";

const DEFAULT_LIST_LIMIT = 20;
const INDEX_ID = "memory-index";
const PROPOSAL_NOUN = "proposal";
const DRY_RUN_USAGE = "--dry-run takes no proposal id. Use it alone.";
const TITLE_MAX_CHARS = 60;

const SEARCH_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.TYPE, value: (row) => cellText(row.type) },
  { header: ColumnHeader.PORTAL, value: (row) => cellText(row.portal) },
  { header: ColumnHeader.TITLE, value: (row) => cellText(row.title) },
  { header: "Score", value: (row) => numberOf(row.relevance_score)?.toFixed(2) ?? "-" },
];

const PROJECT_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.NAME, value: (row) => cellText(row.name) },
  { header: "Patterns", value: (row) => String(row.patterns) },
  { header: "Decisions", value: (row) => String(row.decisions) },
];

const EXECUTION_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.TRACE, value: (row) => cellText(row.trace_id).slice(0, TRACE_PREFIX_CHARS) },
  { header: ColumnHeader.STATUS, value: (row) => cellText(row.status) },
  { header: ColumnHeader.PORTAL, value: (row) => cellText(row.portal) },
  { header: ColumnHeader.AGENT, value: (row) => cellText(row.agent_role) },
  { header: "Started", value: (row) => cellText(row.started_at) },
];

const PROPOSAL_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.ID, value: (row) => cellText(row.id) },
  { header: ColumnHeader.TITLE, value: (row) => cellText(row.title).slice(0, TITLE_MAX_CHARS) },
  { header: "Category", value: (row) => cellText(row.category) },
  { header: "Scope", value: (row) => cellText(row.scope) },
];

function splitTags(tags: Opt<string, Reason.OptionalInput>): string[] | undefined {
  return tags ? tags.split(COMMA_SEPARATOR).map((tag) => tag.trim()) : undefined;
}

function createMemoryCommand(runtime: IExaCtlRuntime) {
  const { memoryCommands, memoryCurationCommands, display } = runtime;
  const formatter = new MemoryFormatter();
  const noun = nounDocFor(ExaCtlCommandName.MEMORY);

  const listCommand = new Command().action(async (options) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
    const summary = await memoryCommands.getSummary();
    if (renderer.machine) await renderer.item(toRow(summary), []);
    else await renderer.block(() => formatter.formatListTable(summary), () => formatter.formatListMarkdown(summary));
  });

  const searchCommand = new Command()
    .option(CLI_OPTION_PORTAL_LONG, "Filter by portal")
    .option("--tags <tags:string>", "Filter by tags (comma-separated)")
    .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: DEFAULT_LIST_LIMIT })
    .option("--use-embeddings", "Use embedding-based semantic search")
    .action(async (options, ...args: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      const results = await memoryCommands.search(args[0], {
        portal: options.portal,
        tags: splitTags(options.tags),
        limit: options.limit,
        useEmbeddings: options.useEmbeddings,
      });
      await renderer.list(results.map(toRow), SEARCH_COLUMNS, (row) => cellText(row.id ?? row.title));
    });

  const projectCommand = new Command()
    .description("Project memory operations")
    .command(
      ExaCtlVerb.LIST,
      new Command().action(async (options) => {
        const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
        const projects = await memoryCommands.projectList();
        await renderer.list(projects.map(toRow), PROJECT_COLUMNS, (row) => cellText(row.name));
      }),
    )
    .command(
      `${ExaCtlVerb.SHOW} <portal:string>`,
      new Command().action(async (options, ...args: string[]) => {
        const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        const project = await memoryCommands.projectShow(args[0]);
        if (renderer.machine) await renderer.item(toRow(project), []);
        else {
          await renderer.block(
            () => formatter.formatProjectShowTable(project),
            () => formatter.formatProjectShowMarkdown(project),
          );
        }
      }),
    );

  const listExecutions = new Command()
    .option(CLI_OPTION_PORTAL_LONG, "Filter by portal")
    .option(CLI_LIMIT_OPTION, CLI_LIMIT_HELP, { default: DEFAULT_LIST_LIMIT })
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      const executions = await memoryCommands.executionList({ portal: options.portal, limit: options.limit });
      await renderer.list(executions.map(toRow), EXECUTION_COLUMNS, (row) => cellText(row.trace_id));
    });
  const executionCommand = new Command()
    .description("Execution history operations")
    .command(ExaCtlVerb.LIST, listExecutions)
    .command(
      `${ExaCtlVerb.SHOW} <trace-id:string>`,
      new Command().action(async (options, ...args: string[]) => {
        const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        const execution = await memoryCommands.executionShow(args[0]);
        if (renderer.machine) await renderer.item(toRow(execution), []);
        else {
          await renderer.block(
            () => formatter.formatExecutionShowTable(execution),
            () => formatter.formatExecutionShowMarkdown(execution),
          );
        }
      }),
    );

  const learningCommand = new Command()
    .description("Manage global learnings")
    .command(
      `${ExaCtlVerb.REMOVE} <learning-id:string>`,
      new Command()
        .option(CLI_OPTION_REASON, "Deletion reason")
        .action(async (options, ...args: string[]) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await confirmAction(runtime, "memory learning remove", `Remove learning ${args[0]}?`, options);
          await memoryCurationCommands.deleteLearning(args[0], options.reason);
          display.info("cli.memory.learning.removed", args[0], { status: MutationStatus.DELETED });
          await renderer.mutation(
            [{ id: args[0], action: ExaCtlVerb.REMOVE, status: MutationStatus.DELETED }],
            false,
          );
        }),
    );

  const indexCommand = new Command()
    .description("Manage memory bank search indices")
    .command(
      ExaCtlVerb.REBUILD,
      new Command()
        .option("--include-embeddings", "Regenerate embedding vectors for all learnings")
        .action(async (options) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          const result = await memoryCommands.rebuildIndex({ includeEmbeddings: options.includeEmbeddings });
          display.info("cli.memory.index.rebuilt", INDEX_ID, { embeddings: result.embeddings ?? 0 });
          await renderer.mutation(
            [{
              id: INDEX_ID,
              action: ExaCtlVerb.REBUILD,
              status: MutationStatus.REBUILT,
              embeddings: result.embeddings,
            }],
            false,
          );
        }),
    );

  const proposalCommand = createProposalCommand(runtime, formatter);

  const command = documentedNoun(new Command(), noun)
    .command(ExaCtlVerb.LIST, listCommand)
    .command(`${ExaCtlVerb.SEARCH} <query:string>`, searchCommand)
    .command(ExaCtlSubNoun.PROJECT, projectCommand)
    .command(ExaCtlSubNoun.EXECUTION, executionCommand)
    .command(ExaCtlSubNoun.LEARNING, learningCommand)
    .command(ExaCtlSubNoun.INDEX, indexCommand)
    .command(ExaCtlSubNoun.PROPOSAL, proposalCommand);
  const name = ExaCtlCommandName.MEMORY;
  documentLeaves(command, [name], noun.lifecycle);
  for (
    const [subNoun, child] of [
      [ExaCtlSubNoun.PROJECT, projectCommand],
      [ExaCtlSubNoun.EXECUTION, executionCommand],
      [ExaCtlSubNoun.LEARNING, learningCommand],
      [ExaCtlSubNoun.INDEX, indexCommand],
      [ExaCtlSubNoun.PROPOSAL, proposalCommand],
    ] as const
  ) documentLeaves(child, [name, subNoun], noun.lifecycle);
  return command;
}

function createProposalCommand(runtime: IExaCtlRuntime, formatter: MemoryFormatter) {
  const { memoryCurationCommands, display } = runtime;
  const proposalRows = (proposals: Awaited<ReturnType<typeof memoryCurationCommands.pendingList>>): IJsonRow[] =>
    proposals.map((proposal) =>
      toRow({
        ...proposal,
        title: proposal.learning.title,
        category: proposal.learning.category,
        scope: proposal.target_project || MemoryScope.GLOBAL,
      })
    );
  return new Command()
    .description("Manage pending memory update proposals")
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .option("--eligible", "Show only auto-approval eligible pending proposals")
        .action(async (options) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          const proposals = await memoryCurationCommands.pendingList(options.eligible === true);
          await renderer.list(proposalRows(proposals), PROPOSAL_COLUMNS, (row) => cellText(row.id));
        }),
    )
    .command(
      `${ExaCtlVerb.SHOW} <proposal-id:string>`,
      new Command().action(async (options, ...args: string[]) => {
        const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        const proposal = await memoryCurationCommands.pendingShow(args[0]);
        if (renderer.machine) await renderer.item(toRow(proposal), []);
        else {
          await renderer.block(
            () => formatter.formatPendingShowTable(proposal),
            () => formatter.formatPendingShowMarkdown(proposal),
          );
        }
      }),
    )
    .command(
      `${ExaCtlVerb.APPROVE} [proposal-ids...:string]`,
      new Command()
        .option("--all", "Approve every pending proposal")
        .option("--dry-run", "Preview auto-approvable proposals without changing state")
        .action(async (options, ...ids: string[]) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          if (options.dryRun) {
            if (ids.length > 0 || options.all) throw new ExaCtlError(ExaCtlExitCode.USAGE, DRY_RUN_USAGE);
            const eligible = await memoryCurationCommands.pendingApproveDryRun();
            await renderer.list(proposalRows(eligible), PROPOSAL_COLUMNS, (row) => cellText(row.id));
            return;
          }
          const targets = selectBulkTargets(ids, options.all === true, PROPOSAL_NOUN);
          if (targets.all) {
            await confirmAction(runtime, "memory proposal approve --all", "Approve every pending proposal?", options);
          }
          const approvals = targets.all ? await memoryCurationCommands.pendingApproveAll() : [];
          let failure: Error | undefined;
          if (!targets.all) {
            for (const proposalId of targets.ids) {
              try {
                approvals.push(await memoryCurationCommands.pendingApprove(proposalId));
              } catch (error) {
                failure = error as Error;
                break;
              }
            }
          }
          for (const approval of approvals) {
            display.info("cli.memory.proposal.approved", approval.id, {
              title: approval.title,
              merged_to: approval.mergedTo,
            });
          }
          if (approvals.length > 0) {
            await renderer.mutation(
              approvals.map((approval) => ({
                id: approval.id,
                action: ExaCtlVerb.APPROVE,
                status: MutationStatus.APPROVED,
                title: approval.title,
                mergedTo: approval.mergedTo,
              })),
              targets.all || approvals.length > 1,
            );
          }
          if (failure !== undefined) throw failure;
        }),
    )
    .command(
      `${ExaCtlVerb.REJECT} <proposal-id:string>`,
      new Command()
        .option(CLI_OPTION_REASON, "Rejection reason", { required: true })
        .action(async (options, ...args: string[]) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          await memoryCurationCommands.pendingReject(args[0], options.reason);
          display.info("cli.memory.proposal.rejected", args[0], { reason: options.reason });
          await renderer.mutation(
            [{ id: args[0], action: ExaCtlVerb.REJECT, status: MutationStatus.REJECTED, reason: options.reason }],
            false,
          );
        }),
    );
}

export function buildMemoryCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMemoryCommand> {
  return createMemoryCommand(runtime);
}
