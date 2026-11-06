/**
 * @module ExaCtlConstants
 * @path apps/exactl/src/exactl_constants.ts
 * @description The option strings, help texts and blueprint labels that the exactl command builders share.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { UIOutputFormat } from "@exaix/tui";

/** The name of each exactl command that hangs directly under the root command. */
export enum ExaCtlCommandName {
  REQUEST = "request",
  PLAN = "plan",
  REVIEW = "review",
  WAIT = "wait",
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
  TOOL = "tool",
  SKILL = "skill",
  WATCH = "watch",
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

export interface IBlueprintCliLabels {
  createDescription: string;
  nameOption: string;
  listDescription: string;
  listHint: string;
  showDescription: string;
  editDescription: string;
  removeDescription: string;
  deprecateDescription: string;
}

export const CLI_OUTPUT_FORMAT_OPTION = "--format <format:string>";

export const CLI_OUTPUT_FORMAT_HELP = "Output format: table, json, md";

export const CLI_OUTPUT_FORMAT_DEFAULT = { default: UIOutputFormat.TABLE };

export const CLI_OPTION_JSON_HELP = "Output in JSON format";

export const CONFIG_LABEL = "config";

export const CONFIG_VALIDATE_ACTION = "config.validate";

export const CONFIG_DIFF_LABEL = "diff";

export const DEFAULT_CAPABILITIES_LABEL = "general";

export const CLI_LIMIT_OPTION = "-l, --limit <limit:number>";

export const CLI_LIMIT_HELP = "Maximum results";

export const DISPLAY_CATEGORY_BLUEPRINTS = "blueprints";

export const BLUEPRINT_CLI_LABELS: IBlueprintCliLabels = {
  createDescription: "Create a new agent blueprint",
  nameOption: "Agent name (required)",
  listDescription: "List all agent blueprints",
  listHint: 'Create a blueprint with: exactl blueprint create <agent-id> --name "Name" --model "provider:model"',
  showDescription: "Show blueprint details",
  editDescription: "Edit blueprint in $EDITOR",
  removeDescription: "Remove a blueprint",
  deprecateDescription: "Mark a blueprint as deprecated (retires it without deleting the file)",
};

export const CLI_CMD_SHOW_ID = "show <id>";

export const CLI_CMD_LIST = "list";

export const CLI_OPTION_REASON = "-r, --reason <reason:string>";

export const CLI_OPTION_MODEL = "-m, --model <model:string>";

export const CLI_OPTION_PORTAL = "-p, --portal <portal:string>";

export const CLI_PORTAL_LONG_OPTION = "--portal <portal:string>";

export const CLI_OPTION_WAIT_STATUS = "-s, --status <status:string>";

export const CLI_OPTION_WAIT_MESSAGE = "-m, --message <message:string>";

export const CLI_OPTION_WAIT_MESSAGE_DESC = "Resolution summary";

export const CLI_OPTION_WAIT_RESOLVED_BY = "--resolved-by <actor:string>";

export const CLI_OPTION_WAIT_RESOLVED_BY_DESC = "Actor identity resolving this wait state, recorded for audit";
