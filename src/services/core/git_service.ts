/**
 * @module GitServiceShim
 * @path src/services/core/git_service.ts
 * @description Compatibility shim wrapping Git service implementations from @exaix/git.
 * @architectural-layer Services
 * @related-files [src/services/agent/execution_loop.ts, src/mcp/handlers/git_commit_tool.ts]
 */

import {
  GitCorruptionError as GitCorruptionErrorBase,
  GitError as GitErrorBase,
  GitNothingToCommitError as GitNothingToCommitErrorBase,
  GitSecurityError as GitSecurityErrorBase,
  GitService as GitServiceBase,
} from "@exaix/git";

export class GitError extends GitErrorBase {}
export class GitCorruptionError extends GitCorruptionErrorBase {}
export class GitNothingToCommitError extends GitNothingToCommitErrorBase {}
export class GitSecurityError extends GitSecurityErrorBase {}

export class GitService extends GitServiceBase {}
