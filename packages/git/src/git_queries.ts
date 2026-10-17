/**
 * @module GitQueries
 * @path packages/git/src/git_queries.ts
 * @related-files [packages/git/tests/git_queries_test.ts]
 * @architectural-layer Services
 * @description Read-only git queries over an IGitService. Callers use them so the git subcommand constants stay inside this package.
 */

import type { IGitService } from "@exaix/core/types";
import { GIT_CMD_DIFF, GIT_CMD_REV_PARSE, GIT_FLAG_NAME_ONLY } from "./constants.ts";

/** Returns the current HEAD sha of the repo, or an empty string when it is unreadable. */
export async function readHeadSha(gitService: IGitService): Promise<string> {
  const result = await gitService.runGitCommand([GIT_CMD_REV_PARSE, "HEAD"], { throwOnError: false });
  return result.exitCode === 0 ? result.output.trim() : "";
}

/** Returns the repo-relative paths changed between two commits. The list is empty when they are equal or the diff fails. */
export async function listChangedFilesBetween(
  gitService: IGitService,
  before: string,
  after: string,
): Promise<string[]> {
  if (!before || !after || before === after) return [];
  const result = await gitService.runGitCommand([GIT_CMD_DIFF, GIT_FLAG_NAME_ONLY, before, after], {
    throwOnError: false,
  });
  if (result.exitCode !== 0) return [];
  return result.output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
