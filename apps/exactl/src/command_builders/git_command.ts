/**
 * @module ExaCtlGitCommand
 * @path apps/exactl/src/command_builders/git_command.ts
 * @description Builds the exactl git command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { confirmAction } from "../output/exactl_confirm.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { Command } from "@cliffy/command";
import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { GitService } from "@exaix/git";
import { GIT_CMD_STATUS } from "@exaix/git/constants.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_PORTAL_LONG_OPTION,
  ExaCtlCommandName,
  ExaCtlSubNoun,
  ExaCtlVerb,
  MutationStatus,
} from "../exactl_constants.ts";
import {
  actionOutput,
  cellText,
  EMPTY_CELL,
  type IJsonRow,
  toRow,
  TRACE_PREFIX_CHARS,
} from "../output/exactl_output.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const SHORT_SHA_CHARS = 8;
const HEADS_PREFIX = /^refs\/heads\//;
const DETACHED_LABEL = "(detached)";
const UNKNOWN_LABEL = "(unknown)";
const CURRENT_MARK = "*";
const REPO_OPTION = "--repo <repo:string>";
const REPO_HELP = "Target a repository path (absolute or relative)";
const PORTAL_HELP = "Target a configured portal repository";

const WORKTREE_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Path", value: (row) => cellText(row.path) },
  { header: "Branch", value: (row) => cellText(row.branch) },
  { header: "Head", value: (row) => cellText(row.head).slice(0, SHORT_SHA_CHARS) },
  { header: "Locked", value: (row) => row.locked === true ? "yes" : EMPTY_CELL },
  { header: "Prunable", value: (row) => row.prunable === true ? "yes" : EMPTY_CELL },
];

const BRANCH_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Branch", value: (row) => `${row.is_current === true ? CURRENT_MARK : " "} ${cellText(row.name)}` },
  { header: "Last commit", value: (row) => cellText(row.last_commit) },
  { header: "Date", value: (row) => cellText(row.last_commit_date) },
  { header: "Trace", value: (row) => cellText(row.trace_id).slice(0, TRACE_PREFIX_CHARS) },
];

const COMMIT_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Commit", value: (row) => cellText(row.sha).slice(0, SHORT_SHA_CHARS) },
  { header: "Message", value: (row) => cellText(row.message) },
  { header: "Author", value: (row) => cellText(row.author) },
  { header: "Date", value: (row) => cellText(row.date) },
];

function resolveWorktreeTarget(
  runtime: IExaCtlRuntime,
  portalName: Opt<string, Reason.OptionalInput>,
  repo: Opt<string, Reason.OptionalInput>,
) {
  const { fullContext, config } = runtime;
  if (portalName && repo) {
    throw new Error("Use either --portal or --repo (not both)");
  }
  let repoPath = config.system.root as string;
  if (portalName) {
    const portal = fullContext.config?.getPortal(portalName);
    if (!portal) throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `Portal not found in config: ${portalName}`);
    repoPath = portal.target_path;
  } else if (repo) {
    repoPath = repo;
  }
  return { repoPath, effectiveGit: new GitService({ config, repoPath }) };
}

function createGitCommand(runtime: IExaCtlRuntime) {
  const { gitCommands } = runtime;
  const worktreeList = new Command()
    .option(CLI_PORTAL_LONG_OPTION, PORTAL_HELP)
    .option(REPO_OPTION, REPO_HELP)
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      try {
        const { effectiveGit } = resolveWorktreeTarget(runtime, options.portal, options.repo);
        const worktrees = await effectiveGit.listWorktrees();
        const rows = worktrees.map((worktree) =>
          toRow({
            path: worktree.path,
            branch: worktree.branch
              ? worktree.branch.replace(HEADS_PREFIX, "")
              : worktree.detached
              ? DETACHED_LABEL
              : UNKNOWN_LABEL,
            head: worktree.head ?? "",
            locked: worktree.locked === true,
            prunable: worktree.prunable === true,
          })
        );
        await renderer.list(rows, WORKTREE_COLUMNS, (row) => cellText(row.path));
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const worktreePrune = new Command()
    .option(CLI_PORTAL_LONG_OPTION, PORTAL_HELP)
    .option(REPO_OPTION, REPO_HELP)
    .option("--dry-run", "Show what would be pruned")
    .option("--verbose", "Verbose output")
    .option("--expire <expire:string>", "Prune entries older than <time> (e.g., 'now', '3.days.ago')")
    .action(async (options) => {
      const { renderer, display: actionDisplay } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        if (!options.dryRun) {
          await confirmAction(runtime, "git worktree prune", "Prune stale git worktree entries?", options);
        }
        const { repoPath, effectiveGit } = resolveWorktreeTarget(runtime, options.portal, options.repo);
        const output = (await effectiveGit.pruneWorktrees({
          dryRun: Boolean(options.dryRun),
          verbose: Boolean(options.verbose),
          expire: options.expire,
        })).trim();
        actionDisplay.info("cli.git.worktrees.pruned", repoPath, {
          dry_run: options.dryRun ? true : null,
          expire: options.expire ?? null,
          output: output.length > 0 ? output : null,
        });
        await renderer.mutation(
          [{
            id: repoPath,
            action: ExaCtlVerb.PRUNE,
            status: options.dryRun ? MutationStatus.PREVIEWED : MutationStatus.PRUNED,
            output,
          }],
          false,
        );
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const branchList = new Command()
    .option("--pattern <pattern:string>", "Filter by pattern (e.g., 'feat/*')")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      try {
        const branches = await gitCommands.listBranches(options.pattern);
        await renderer.list(branches.map(toRow), BRANCH_COLUMNS, (row) => cellText(row.name));
      } catch (error) {
        failCommand(error as Error);
      }
    });
  const statusCommand = new Command().action(async (options) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    try {
      const status = await gitCommands.status();
      const lists: readonly (readonly [string, string[]])[] = [
        ["Modified", status.modified],
        ["Added", status.added],
        ["Deleted", status.deleted],
        ["Untracked", status.untracked],
      ];
      const clean = lists.every(([, files]) => files.length === 0);
      const fields: IExaCtlColumn<IJsonRow>[] = [
        { header: "Branch", value: () => status.branch },
        ...lists.map(([header, files]) => ({ header, value: () => files.join(", ") || EMPTY_CELL })),
        { header: "Clean", value: () => clean ? "yes" : "no" },
      ];
      await renderer.item(toRow({ ...status, clean }), fields);
    } catch (error) {
      failCommand(error as Error);
    }
  });
  const logCommand = new Command()
    .option("--trace <trace_id:string>", "Filter by trace ID", { required: true })
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      try {
        const commits = await gitCommands.logByTraceId(options.trace);
        await renderer.list(commits.map(toRow), COMMIT_COLUMNS, (row) => cellText(row.sha));
      } catch (error) {
        failCommand(error as Error);
      }
    });

  const noun = nounDocFor(ExaCtlCommandName.GIT);
  const worktree = new Command().description("Git worktree maintenance")
    .command(ExaCtlVerb.LIST, worktreeList)
    .command(ExaCtlVerb.PRUNE, worktreePrune);
  const branch = new Command().description("Git branch operations").command(ExaCtlVerb.LIST, branchList);
  const command = documentedNoun(new Command(), noun)
    .command(ExaCtlSubNoun.WORKTREE, worktree)
    .command(ExaCtlSubNoun.BRANCH, branch)
    .command(GIT_CMD_STATUS, statusCommand)
    .command(ExaCtlVerb.LOG, logCommand);
  const name = ExaCtlCommandName.GIT;
  documentLeaves(command, [name], noun.lifecycle);
  documentLeaves(worktree, [name, ExaCtlSubNoun.WORKTREE], noun.lifecycle);
  documentLeaves(branch, [name, ExaCtlSubNoun.BRANCH], noun.lifecycle);
  return command;
}

export function buildGitCommand(runtime: IExaCtlRuntime): ReturnType<typeof createGitCommand> {
  return createGitCommand(runtime);
}
