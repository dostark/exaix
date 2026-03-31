/**
 * @module GitAdapter
 * @path src/services/adapters/git_adapter.ts
 * @description Provides adapter for Git operations to satisfy architectural boundary requirements.
 * @architectural-layer Services/Adapters
 * @dependencies [IGitService, GitService]
 * @related-files [src/services/core/git_service.ts, src/cli/commands/review_commands.ts]
 */

import { GitService } from "../core/git_service.ts";
import type { IGitService } from "../../shared/interfaces/i_git_service.ts";
import type { IDatabaseService } from "../../shared/interfaces/i_database_service.ts";

export interface IGitServiceOptions {
  config: any;
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
