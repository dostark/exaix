/**
 * @module GitAdapter
 * @path src/services/adapters/git_adapter.ts
 * @description Provides adapter for Git operations to satisfy architectural boundary requirements.
 * @architectural-layer Services/Adapters
 * @related-files [packages/git/src/git_service.ts, apps/exactl/src/commands/review_commands.ts]
 */

import { GitService } from "@exaix/git";
import type { IDatabaseService, IGitService } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";

export interface IGitServiceOptions {
  config: Config;
  db: IDatabaseService;
  repoPath: string;
  traceId: string;
  identityId: string;
}

/**
 * Creates an instance of IGitService for a specific repository.
 */
export function createGitService(options: IGitServiceOptions): IGitService {
  return new GitService(options);
}
