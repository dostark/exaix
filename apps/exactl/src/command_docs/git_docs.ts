/**
 * @module GitCommandDocs
 * @path apps/exactl/src/command_docs/git_docs.ts
 * @description The doc records of the exactl git noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/git_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { GIT_CMD_STATUS } from "@exaix/git/constants.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const GIT = ExaCtlCommandName.GIT;
const WORKTREE = ExaCtlSubNoun.WORKTREE;
const BRANCH = ExaCtlSubNoun.BRANCH;

export const GIT_NOUN_DOC: IExaCtlNounDoc = {
  noun: GIT,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Inspect the repositories that the agents work in",
  description:
    "Read the branches, the worktrees, the status and the commits of the workspace repository or of a portal repository. Commits that an agent made carry a trace id.",
  lifecycle: [],
};

export const GIT_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [GIT, WORKTREE, ExaCtlVerb.LIST],
    summary: "List the git worktrees",
    description:
      "Lists the worktrees of the workspace repository. Target a portal with `--portal` or a path with `--repo`.",
    examples: [
      { title: "List worktrees", command: "exactl git worktree list" },
      { title: "List the worktrees of a portal", command: "exactl git worktree list --portal api -o json" },
    ],
    seeAlso: [exactlCommand(GIT, WORKTREE, ExaCtlVerb.PRUNE), exactlCommand(GIT, BRANCH, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [GIT, WORKTREE, ExaCtlVerb.PRUNE],
    summary: "Prune stale git worktree metadata",
    description:
      "Removes the metadata of worktrees whose directories are gone. `--dry-run` shows what it would remove. Asks for confirmation unless `--dry-run` is set. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [
      { title: "Preview the prune", command: "exactl git worktree prune --dry-run" },
      { title: "Prune old entries", command: "exactl git worktree prune --expire 3.days.ago" },
      { title: "Prune without a prompt", command: "exactl git worktree prune --yes" },
    ],
    seeAlso: [exactlCommand(GIT, WORKTREE, ExaCtlVerb.LIST), exactlCommand(GIT, GIT_CMD_STATUS)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [GIT, BRANCH, ExaCtlVerb.LIST],
    summary: "List the branches",
    description: "Lists the branches of the workspace repository, newest first, with the trace id of the last commit.",
    examples: [
      { title: "List branches", command: "exactl git branch list" },
      { title: "List feature branches", command: "exactl git branch list --pattern 'feat/*'" },
    ],
    seeAlso: [exactlCommand(GIT, ExaCtlVerb.LOG), exactlCommand(GIT, GIT_CMD_STATUS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [GIT, GIT_CMD_STATUS],
    summary: "Show the repository status",
    description: "Shows the current branch and the modified, added, deleted and untracked files.",
    examples: [{ title: "Show the status", command: "exactl git status" }],
    seeAlso: [exactlCommand(GIT, BRANCH, ExaCtlVerb.LIST), exactlCommand(GIT, ExaCtlVerb.LOG)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [GIT, ExaCtlVerb.LOG],
    summary: "Search the commit log by trace id",
    description: "Lists the commits of every branch that carry the trace id.",
    examples: [{ title: "Find the commits of a trace", command: "exactl git log --trace 7b1d4e60" }],
    seeAlso: [exactlCommand(GIT, BRANCH, ExaCtlVerb.LIST), exactlCommand(GIT, GIT_CMD_STATUS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
];
