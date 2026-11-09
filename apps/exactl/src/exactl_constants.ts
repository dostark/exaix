/**
 * @module ExaCtlConstants
 * @path apps/exactl/src/exactl_constants.ts
 * @description The option strings, help texts and blueprint labels that the exactl command builders share.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

/** The name of each exactl command that hangs directly under the root command. */
export enum ExaCtlCommandName {
  REQUEST = "request",
  PLAN = "plan",
  REVIEW = "review",
  APPROVAL = "approval",
  GIT = "git",
  DAEMON = "daemon",
  PORTAL = "portal",
  CONFIG = "config",
  BLUEPRINT = "blueprint",
  FLOW = "flow",
  MEMORY = "memory",
  DASHBOARD = "dashboard",
  MCP = "mcp",
  LOG = "log",
  MODEL = "model",
  VERSION = "version",
  MIGRATE = "migrate",
  SKILL = "skill",
  EVAL = "eval",
}

/** Every verb an exactl leaf may use. A new verb is a change to this enum. */
export enum ExaCtlVerb {
  LIST = "list",
  SHOW = "show",
  CREATE = "create",
  ADD = "add",
  EDIT = "edit",
  REMOVE = "remove",
  VALIDATE = "validate",
  APPROVE = "approve",
  REJECT = "reject",
  REVISE = "revise",
  AMEND = "amend",
  EXPIRE = "expire",
  CANCEL = "cancel",
  DEPRECATE = "deprecate",
  RUN = "run",
  WATCH = "watch",
  SEARCH = "search",
  MATCH = "match",
  EXPLAIN = "explain",
  ANALYZE = "analyze",
  REFRESH = "refresh",
  REBUILD = "rebuild",
  DERIVE = "derive",
  CLARIFY = "clarify",
  INSPECT = "inspect",
  GET = "get",
  SET = "set",
  UNSET = "unset",
  DIFF = "diff",
  HISTORY = "history",
  ROLLBACK = "rollback",
  COMPACT = "compact",
  START = "start",
  STOP = "stop",
  RESTART = "restart",
  STATUS = "status",
  LOGS = "logs",
  SERVE = "serve",
  CALL = "call",
  PRUNE = "prune",
  USE = "use",
  VERIFY = "verify",
  WAIT = "wait",
  COMPARE = "compare",
  REPORT = "report",
  GENERATE = "generate",
  SCORE = "score",
  CHECK = "check",
  BINDINGS = "bindings",
  REVISIONS = "revisions",
  USAGE = "usage",
  CANDIDATES = "candidates",
  EXPORT_OTEL = "export-otel",
  /** `git log`. */
  LOG = "log",
  /** `log cost`. */
  COST = "cost",
}

/** The status a definition-noun mutation reports for the entity it changed. */
export enum MutationStatus {
  CREATED = "created",
  ADDED = "added",
  EDITED = "edited",
  REMOVED = "removed",
  DEPRECATED = "deprecated",
  DERIVED = "derived",
  REFRESHED = "refreshed",
  ANALYZED = "analyzed",
  DELETED = "deleted",
  REBUILT = "rebuilt",
  APPROVED = "approved",
  REJECTED = "rejected",
  PRUNED = "pruned",
  PREVIEWED = "previewed",
  SET = "set",
  UNSET = "unset",
  ROLLED_BACK = "rolled_back",
  APPLIED = "applied",
  COMPACTED = "compacted",
  BLOCKED = "blocked",
  LOCKED = "locked",
  UNLOCKED = "unlocked",
  ACTIVE = "active",
}

/** Sub-nouns: a command that owns verbs but is not a root. */
export enum ExaCtlSubNoun {
  AMENDMENT = "amendment",
  PROJECT = "project",
  EXECUTION = "execution",
  PROPOSAL = "proposal",
  LEARNING = "learning",
  INDEX = "index",
  KNOWLEDGE = "knowledge",
  ROUTE = "route",
  BRANCH = "branch",
  WORKTREE = "worktree",
  TOOL = "tool",
  LOCK = "lock",
  BLOCK = "block",
  PROFILE = "profile",
  CALIBRATION = "calibration",
}

export const CLI_OUTPUT_FORMAT_OPTION = "--format <format:string>";

export const DEFAULT_CAPABILITIES_LABEL = "general";

export const CLI_LIMIT_OPTION = "-n, --limit <limit:number>";

export const CLI_LIMIT_HELP = "Maximum results";

export const COMMA_SEPARATOR = ",";

export const CLI_CMD_LIST = "list";

export const CLI_OPTION_REASON = "-r, --reason <reason:string>";

export const CLI_OPTION_MODEL = "-m, --model <model:string>";

export const CLI_OPTION_PORTAL = "-p, --portal <portal:string>";
/** The portal option without a short letter, for the nouns that follow the short-flag policy. */
export const CLI_OPTION_PORTAL_LONG = "--portal <portal:string>";

export const CLI_PORTAL_LONG_OPTION = "--portal <portal:string>";

export const CLI_OPTION_WAIT_STATUS = "-s, --status <status:string>";
export const CLI_OPTION_APPROVAL_KIND = "--kind <kinds:string[]>";
export const CLI_OPTION_APPROVAL_KIND_DESC =
  "Only these kinds, comma-separated: plan, amendment, review, clarification, proposal, skill, wait, tool";

export const CLI_OPTION_WAIT_MESSAGE = "--message <message:string>";

export const CLI_OPTION_WAIT_MESSAGE_DESC = "Resolution summary";

export const CLI_OPTION_WAIT_RESOLVED_BY = "--resolved-by <actor:string>";

export const CLI_OPTION_WAIT_RESOLVED_BY_DESC = "Actor identity resolving this wait state, recorded for audit";
