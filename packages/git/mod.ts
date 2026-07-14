/**
 * @module GitPackage
 * @path packages/git/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer Services
 * @description Package entrypoint for @exaix/git. Exports enums, interfaces, the git service,
 * configurable defaults, and error constants. Low-level git subcommand strings (GIT_CMD_*)
 * are intentionally NOT re-exported — they are internal to the package.
 */

export * from "./src/enums.ts";
export * from "./src/i_git_service.ts";
export * from "./src/git_service.ts";

// Selectively export non-subcommand constants (configurable defaults, error strings, git SHA)
export {
  DEFAULT_GIT_ALLOWED_PREFIXES,
  DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES,
  DEFAULT_GIT_BRANCH_PREFIX_PATTERN,
  DEFAULT_GIT_BRANCH_SUFFIX_LENGTH,
  DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
  DEFAULT_GIT_CLEAN_TIMEOUT_MS,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_DIFF_TIMEOUT_MS,
  DEFAULT_GIT_EXIT_CODE_FATAL,
  DEFAULT_GIT_LOG_TIMEOUT_MS,
  DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
  DEFAULT_GIT_MAX_RETRIES,
  DEFAULT_GIT_RETRY_BACKOFF_BASE_MS,
  DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
  DEFAULT_GIT_REVERT_CONCURRENCY_LIMIT,
  DEFAULT_GIT_STATUS_TIMEOUT_MS,
  DEFAULT_GIT_TRACE_ID_SHORT_LENGTH,
  GIT_EMPTY_SHA,
  GIT_ERROR_NOT_A_REPO,
  GIT_ERROR_NOTHING_TO_COMMIT,
  GIT_TIMEOUT_MS_MAX,
  GIT_TIMEOUT_MS_MIN,
} from "./src/constants.ts";
