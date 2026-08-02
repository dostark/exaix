/**
 * @module GitConstants
 * @path packages/git/src/constants.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Git-related constants for repository operations and validation.
 *   Duplicate constants are re-exported from @exaix/core to avoid conflicting
 *   sources of truth — the central configurable() registry in core is authoritative.
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";

export const GIT_EMPTY_SHA = "0000000000000000000000000000000000000000";

// Imported from @exaix/core (configurable in core's constants.ts — see check:config-keys)
export const GIT_TIMEOUT_MS_MIN = 1000;
export const GIT_TIMEOUT_MS_MAX = 60000;
export const DEFAULT_GIT_BRANCH_PREFIX_PATTERN = "^(feature|bugfix|hotfix|chore)/";

export const DEFAULT_GIT_ALLOWED_PREFIXES = ["feature/", "bugfix/", "hotfix/", "chore/"];
export {
  DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES,
  DEFAULT_GIT_BRANCH_SUFFIX_LENGTH,
  DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
  DEFAULT_GIT_CLEAN_TIMEOUT_MS,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_DIFF_TIMEOUT_MS,
  DEFAULT_GIT_LOG_TIMEOUT_MS,
  DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
  DEFAULT_GIT_MAX_RETRIES,
  DEFAULT_GIT_RETRY_BACKOFF_BASE_MS,
  DEFAULT_GIT_STATUS_TIMEOUT_MS,
  DEFAULT_GIT_TRACE_ID_SHORT_LENGTH,
} from "@exaix/core";
export const DEFAULT_GIT_REVERT_CONCURRENCY_LIMIT: number = configurable({
  key: "git.revert_concurrency_limit",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Maximum concurrent git revert operations",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_EXIT_CODE_FATAL = 128;
export const DEFAULT_GIT_REV_PARSE_TIMEOUT_MS: number = configurable({
  key: "git.rev_parse_timeout_ms",
  default: 2000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git rev-parse operations",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Git subcommand constants */
export const GIT_CMD_REV_PARSE = "rev-parse";
export const GIT_CMD_WORKTREE = "worktree";
export const GIT_CMD_CONFIG = "config";
export const GIT_CMD_BRANCH = "branch";
export const GIT_CMD_STATUS = "status";
/** List every untracked file individually instead of collapsing new directories to the dir name. */
export const GIT_FLAG_UNTRACKED_FILES_ALL = "--untracked-files=all";
export const GIT_CMD_LIST = "list";
export const GIT_CMD_ADD = "add";
export const GIT_CMD_REMOVE = "remove";
export const GIT_CMD_CHECKOUT = "checkout";
export const GIT_CMD_COMMIT = "commit";
export const GIT_CMD_LOG = "log";
export const GIT_CMD_INIT = "init";

export const GIT_ERROR_NOTHING_TO_COMMIT = "nothing to commit";
export const GIT_ERROR_NOT_A_REPO = "not a git repository";
