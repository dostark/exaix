/**
 * @module ExaCtlGitCommand
 * @path apps/exactl/src/command_builders/git_command.ts
 * @description Builds the exactl git command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE, RequestOperation } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { GitService } from "@exaix/git";
import { GIT_CMD_STATUS } from "@exaix/git/constants.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_PORTAL_LONG_OPTION, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";

function resolveWorktreeTarget(
  runtime: IExaCtlRuntime,
  portalName?: Opt<string, Reason.OptionalInput>,
  repo?: Opt<string, Reason.OptionalInput>,
) {
  const { fullContext, config } = runtime;
  if (portalName && repo) {
    throw new Error("Use either --portal or --repo (not both)");
  }
  let repoPath = config.system.root as string;
  if (portalName) {
    const portal = fullContext.config?.getPortal(portalName);
    if (!portal) throw new Error(`Portal not found in config: ${portalName}`);
    repoPath = portal.target_path;
  } else if (repo) {
    repoPath = repo;
  }
  return { repoPath, effectiveGit: new GitService({ config, repoPath }) };
}

function createGitCommand(runtime: IExaCtlRuntime) {
  const { display, gitCommands } = runtime;
  return new Command()
    .description("Git repository operations")
    .command(
      ExaCtlSubNoun.WORKTREE,
      new Command()
        .description("Git worktree maintenance")
        .command(
          RequestOperation.LIST,
          new Command()
            .description("List git worktrees")
            .option(CLI_PORTAL_LONG_OPTION, "Target a configured portal repository")
            .option("--repo <repo:string>", "Target a repository path (absolute or relative)")
            .action(async (options) => {
              try {
                const { repoPath, effectiveGit } = resolveWorktreeTarget(runtime, options.portal, options.repo);

                const worktrees = await effectiveGit.listWorktrees();
                display.info("git.worktrees.list", repoPath, { count: worktrees.length });

                for (const wt of worktrees) {
                  const branch = wt.branch
                    ? wt.branch.replace(/^refs\/heads\//, "")
                    : wt.detached
                    ? "(detached)"
                    : undefined;

                  display.info(wt.path, branch ?? "(unknown)", {
                    head: wt.head ? `${wt.head.substring(0, 8)}...` : null,
                    locked: wt.locked ? true : null,
                    prunable: wt.prunable ? true : null,
                  });
                }
              } catch (error) {
                display.error("cli.error", "git worktree list", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        )
        .command(
          ExaCtlVerb.PRUNE,
          new Command()
            .description("Prune stale git worktree metadata")
            .option(CLI_PORTAL_LONG_OPTION, "Target a configured portal repository")
            .option("--repo <repo:string>", "Target a repository path (absolute or relative)")
            .option("--dry-run", "Show what would be pruned")
            .option("--verbose", "Verbose output")
            .option("--expire <expire:string>", "Prune entries older than <time> (e.g., 'now', '3.days.ago')")
            .action(async (options) => {
              try {
                const { repoPath, effectiveGit } = resolveWorktreeTarget(runtime, options.portal, options.repo);

                const output = await effectiveGit.pruneWorktrees({
                  dryRun: Boolean(options.dryRun),
                  verbose: Boolean(options.verbose),
                  expire: options.expire,
                });

                display.info("git.worktrees.prune", repoPath, {
                  dry_run: options.dryRun ? true : null,
                  verbose: options.verbose ? true : null,
                  expire: options.expire ?? null,
                  output: output.trim().length > 0 ? output.trim() : null,
                });
              } catch (error) {
                display.error("cli.error", "git worktree prune", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        ),
    )
    .command(
      ExaCtlSubNoun.BRANCH,
      new Command()
        .description("Git branch operations")
        .command(
          RequestOperation.LIST,
          new Command()
            .description("List all branches")
            .option("-p, --pattern <pattern:string>", "Filter by pattern (e.g., 'feat/*')")
            .action(async (options) => {
              try {
                const branches = await gitCommands.listBranches(options.pattern);
                display.info("git.branches", "repository", { count: branches.length });
                for (const branch of branches) {
                  const current = branch.is_current ? "* " : "  ";
                  display.info(`${current}${branch.name}`, branch.name, {
                    last_commit: `${branch.last_commit} (${new Date(branch.last_commit_date).toLocaleDateString()})`,
                    trace: branch.trace_id ? `${branch.trace_id.substring(0, 8)}...` : null,
                  });
                }
              } catch (error) {
                display.error("cli.error", "git branch list", {
                  message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
                });
                Deno.exit(1);
              }
            }),
        ),
    )
    .command(
      GIT_CMD_STATUS,
      new Command()
        .description("Show repository status")
        .action(async () => {
          try {
            const status = await gitCommands.status();
            display.info("git.status", status.branch, {
              modified: status.modified.length > 0 ? status.modified : null,
              added: status.added.length > 0 ? status.added : null,
              deleted: status.deleted.length > 0 ? status.deleted : null,
              untracked: status.untracked.length > 0 ? status.untracked : null,
              clean: status.modified.length === 0 && status.added.length === 0 &&
                  status.deleted.length === 0 && status.untracked.length === 0
                ? true
                : null,
            });
          } catch (error) {
            display.error("cli.error", "git status", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "log",
      new Command()
        .description("Search commit log by trace_id")
        .option("-t, --trace <trace_id:string>", "Filter by trace ID", { required: true })
        .action(async (options) => {
          try {
            const commits = await gitCommands.logByTraceId(options.trace);
            if (commits.length === 0) {
              display.info("git.log", options.trace, { count: 0, message: "No commits found" });
              return;
            }
            display.info("git.log", `${options.trace.substring(0, 8)}...`, { count: commits.length });
            for (const commit of commits) {
              display.info(commit.sha.substring(0, 8), commit.message, {
                author: commit.author,
                date: new Date(commit.date).toLocaleString(),
              });
            }
          } catch (error) {
            display.error("cli.error", "git log", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

export function buildGitCommand(runtime: IExaCtlRuntime): ReturnType<typeof createGitCommand> {
  return createGitCommand(runtime);
}
