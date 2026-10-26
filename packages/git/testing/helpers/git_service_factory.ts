/**
 * @module GitServiceFactoryTestHelper
 * @path packages/git/testing/helpers/git_service_factory.ts
 * @architectural-layer Services
 * @related-files ["packages/git/testing/helpers/git_test_helper.ts"]
 * @ungrounded
 * @description Builds an `IGitServiceFactory` that creates real `GitService` instances for a given config, as git-backed tests need.
 */

import type { IGitServiceFactory } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";
import { GitService } from "@exaix/git";

/** Returns a factory whose `createGitService` builds a `GitService` for the repo and trace it is given. */
export function createGitServiceFactory(config: Config): IGitServiceFactory {
  return {
    createGitService: (repoPath: string, traceId: string) => new GitService({ config, repoPath, traceId }),
  };
}
