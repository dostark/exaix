/**
 * @module GitAdapter
 * @path src/services/adapters/git_adapter.ts
 * @description Provides adapter for Git operations to satisfy architectural boundary requirements.
 * @architectural-layer Services/Adapters
 * @related-files [src/services/core/git_service.ts, src/cli/commands/review_commands.ts]
 */

import { GitService } from "@exaix/git";
import type { IDatabaseService, IGitService } from "@exaix/core/types/mod.ts";
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
