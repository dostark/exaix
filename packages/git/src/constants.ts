/**
 * @module GitConstants
 * @path packages/git/src/constants.ts
 * @description Git-related constants for repository operations and validation.
 */

export const GIT_EMPTY_SHA = "0000000000000000000000000000000000000000";

export const GIT_TIMEOUT_MS_MIN = 1000;
export const GIT_TIMEOUT_MS_MAX = 60000;
export const GIT_MAX_RETRIES_MIN = 1;
export const GIT_MAX_RETRIES_MAX = 10;
export const GIT_RETRY_BACKOFF_BASE_MS_MIN = 100;
export const GIT_RETRY_BACKOFF_BASE_MS_MAX = 10000;
export const GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MIN = 1;
export const GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MAX = 10;
export const GIT_TRACE_ID_SHORT_LENGTH_MIN = 4;
export const GIT_TRACE_ID_SHORT_LENGTH_MAX = 16;
export const GIT_BRANCH_SUFFIX_LENGTH_MIN = 4;
export const GIT_BRANCH_SUFFIX_LENGTH_MAX = 16;

export const DEFAULT_GIT_BRANCH_PREFIX_PATTERN = "^(feature|bugfix|hotfix|chore)/";
export const DEFAULT_GIT_ALLOWED_PREFIXES = ["feature/", "bugfix/", "hotfix/", "chore/"];
export const DEFAULT_GIT_STATUS_TIMEOUT_MS = 10000;
export const DEFAULT_GIT_LS_FILES_TIMEOUT_MS = 15000;
export const DEFAULT_GIT_CHECKOUT_TIMEOUT_MS = 30000;
export const DEFAULT_GIT_CLEAN_TIMEOUT_MS = 20000;
export const DEFAULT_GIT_LOG_TIMEOUT_MS = 20000;
export const DEFAULT_GIT_DIFF_TIMEOUT_MS = 30000;
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
export const DEFAULT_GIT_MAX_RETRIES = 3;
export const DEFAULT_GIT_RETRY_BACKOFF_BASE_MS = 1000;
export const DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES = 5;
export const DEFAULT_GIT_TRACE_ID_SHORT_LENGTH = 8;
export const DEFAULT_GIT_BRANCH_SUFFIX_LENGTH = 8;
export const DEFAULT_GIT_REVERT_CONCURRENCY_LIMIT = 1;
export const DEFAULT_GIT_EXIT_CODE_FATAL = 128;
export const DEFAULT_GIT_REV_PARSE_TIMEOUT_MS = 2000;

/** Git subcommand constants */
export const GIT_CMD_REV_PARSE = "rev-parse";
export const GIT_CMD_WORKTREE = "worktree";
export const GIT_CMD_CONFIG = "config";
export const GIT_CMD_BRANCH = "branch";
export const GIT_CMD_STATUS = "status";
export const GIT_CMD_LIST = "list";

export const GIT_ERROR_NOTHING_TO_COMMIT = "nothing to commit";
export const GIT_ERROR_NOT_A_REPO = "not a git repository";
