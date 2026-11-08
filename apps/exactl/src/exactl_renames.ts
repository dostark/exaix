/**
 * @module ExaCtlRenames
 * @path apps/exactl/src/exactl_renames.ts
 * @description The table of removed exactl command paths and the hint text that names the replacement.
 * @architectural-layer CLI
 * @dependencies []
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/tests/exactl_renames_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlVerb } from "./exactl_constants.ts";
import { MAX_HINT_ECHO_CHARS, quoteArgument, quoteForShell } from "./exactl_shell.ts";

/** One removed command path and the path that replaces it. */
export interface IExaCtlRename {
  /** Old path words after `exactl`, such as `["blueprint", "ls"]`. */
  readonly legacy: readonly string[];
  /** New invocation shown to the user, such as `exactl blueprint list`. A text with `<placeholders>` is a usage template. */
  readonly canonical: string;
  /** Set where the legacy leaf became a noun. The row skips a next word that is a valid subcommand. */
  readonly unlessNextIn?: Opt<readonly string[], Reason.OptionalInput>;
}

/** One removed option of a command path and the option that replaces it. */
interface IExaCtlOptionRename {
  /** Command words after `exactl`, such as `["request", "create"]`. */
  readonly path: readonly string[];
  readonly legacyOption: string;
  readonly canonicalOption: string;
}

const LEGACY_JOURNAL = "journal";
const LEGACY_MEMORY = "memory";
const LEGACY_CONFIG = "config";
const LEGACY_PLAN = "plan";
const LEGACY_PORTAL = "portal";
const LEGACY_WAIT = "wait";
const LEGACY_TOOL = "tool";
const USAGE_TEMPLATE_MARKER = "<";
export const REQUEST_NOUN = "request";
const CREATE_VERB = "create";
const OPTION_PREFIX = "-";
const OPTION_TERMINATOR = "--";
const OPTION_VALUE_SEPARATOR = "=";
const AGENT_OPTION = "--agent";

export const EXACTL_RENAMES: readonly IExaCtlRename[] = [
  { legacy: ["blueprint", "agent-role"], canonical: "exactl blueprint" },
  { legacy: ["blueprint", "ls"], canonical: "exactl blueprint list" },
  { legacy: ["blueprint", "rm"], canonical: "exactl blueprint remove" },
  { legacy: [LEGACY_JOURNAL], canonical: "exactl log list" },
  { legacy: ["logs"], canonical: "exactl log list" },
  { legacy: ["log", LEGACY_JOURNAL], canonical: "exactl log list" },
  { legacy: [LEGACY_JOURNAL, "wait"], canonical: "exactl log wait" },
  { legacy: ["log", LEGACY_JOURNAL, "wait"], canonical: "exactl log wait" },
  { legacy: [LEGACY_JOURNAL, "verify"], canonical: "exactl log verify" },
  { legacy: ["log", LEGACY_JOURNAL, "verify"], canonical: "exactl log verify" },
  { legacy: ["cost"], canonical: "exactl log cost" },
  { legacy: [LEGACY_JOURNAL, "export-otel"], canonical: "exactl log export-otel" },
  { legacy: ["skills"], canonical: "exactl skill" },
  { legacy: [LEGACY_MEMORY, "skill"], canonical: "exactl skill" },
  { legacy: ["models"], canonical: "exactl model" },
  { legacy: ["models", "pricing"], canonical: "exactl model list" },
  { legacy: ["routing", "explain"], canonical: "exactl model route explain" },
  { legacy: ["routing", "policy", "validate"], canonical: "exactl model route validate" },
  { legacy: [LEGACY_CONFIG, "model"], canonical: "exactl model candidates" },
  { legacy: [LEGACY_CONFIG, "set-provider"], canonical: "exactl model use" },
  { legacy: [LEGACY_CONFIG, "set-model"], canonical: "exactl config set models.<name>.model <model>" },
  { legacy: [LEGACY_PLAN, "approve-all"], canonical: "exactl plan approve --all" },
  { legacy: [LEGACY_PLAN, "amendment", "show-all"], canonical: "exactl plan amendment show --all" },
  { legacy: [LEGACY_PLAN, "amendment", "approve-all"], canonical: "exactl plan amendment approve --all" },
  { legacy: [LEGACY_MEMORY, "pending"], canonical: "exactl memory proposal" },
  { legacy: [LEGACY_MEMORY, "pending", "approve-all"], canonical: "exactl memory proposal approve --all" },
  { legacy: [LEGACY_MEMORY, "delete-learning"], canonical: "exactl memory learning remove" },
  { legacy: [LEGACY_MEMORY, "rebuild-index"], canonical: "exactl memory index rebuild" },
  { legacy: ["git", "branches"], canonical: "exactl git branch list" },
  { legacy: ["git", "worktrees"], canonical: "exactl git worktree" },
  { legacy: [LEGACY_PORTAL, "analyze"], canonical: "exactl portal knowledge analyze" },
  {
    legacy: [LEGACY_PORTAL, "knowledge"],
    canonical: "exactl portal knowledge show",
    unlessNextIn: ["analyze", "show"],
  },
  { legacy: [LEGACY_CONFIG, "lock"], canonical: "exactl config lock add", unlessNextIn: ["add", "list", "remove"] },
  { legacy: [LEGACY_CONFIG, "unlock"], canonical: "exactl config lock remove" },
  { legacy: [LEGACY_CONFIG, "lock-list"], canonical: "exactl config lock list" },
  { legacy: [LEGACY_CONFIG, "use-profile"], canonical: "exactl config profile use" },
  { legacy: [LEGACY_CONFIG, "list-profiles"], canonical: "exactl config profile list" },
  { legacy: [LEGACY_CONFIG, "set-path"], canonical: "exactl config set paths.<key> <dir>" },
  { legacy: [LEGACY_WAIT], canonical: "exactl approval <list|show|approve|reject|amend|expire|cancel>" },
  { legacy: [LEGACY_WAIT, "list"], canonical: "exactl approval list" },
  { legacy: [LEGACY_WAIT, ExaCtlVerb.APPROVE], canonical: `exactl approval ${ExaCtlVerb.APPROVE} wait:<token>` },
  { legacy: [LEGACY_WAIT, ExaCtlVerb.REJECT], canonical: `exactl approval ${ExaCtlVerb.REJECT} wait:<token>` },
  { legacy: [LEGACY_WAIT, ExaCtlVerb.AMEND], canonical: `exactl approval ${ExaCtlVerb.AMEND} wait:<token>` },
  { legacy: [LEGACY_WAIT, ExaCtlVerb.EXPIRE], canonical: `exactl approval ${ExaCtlVerb.EXPIRE} wait:<token>` },
  { legacy: [LEGACY_WAIT, ExaCtlVerb.CANCEL], canonical: `exactl approval ${ExaCtlVerb.CANCEL} wait:<token>` },
  { legacy: [LEGACY_TOOL], canonical: "exactl approval <list|show|approve|reject>" },
  { legacy: [LEGACY_TOOL, "pending"], canonical: "exactl approval list" },
  { legacy: [LEGACY_TOOL, "confirm"], canonical: `exactl approval ${ExaCtlVerb.APPROVE} tool:<id>` },
  { legacy: [LEGACY_TOOL, "deny"], canonical: `exactl approval ${ExaCtlVerb.REJECT} tool:<id>` },
  { legacy: ["watch"], canonical: "exactl request watch --trace <trace-id>" },
  { legacy: ["mcp", "start"], canonical: "exactl mcp serve" },
  {
    legacy: ["mcp", "connect"],
    canonical: "exactl mcp tool list --server <url>, or exactl mcp tool call <tool> --server <url>",
  },
];

const EXACTL_OPTION_RENAMES: readonly IExaCtlOptionRename[] = [
  { path: [REQUEST_NOUN, CREATE_VERB], legacyOption: "--agent-role", canonicalOption: AGENT_OPTION },
  { path: [REQUEST_NOUN, CREATE_VERB], legacyOption: "-a", canonicalOption: AGENT_OPTION },
];

/** The typed words up to the first option token. */
export function leadingWords(argv: readonly string[]): readonly string[] {
  const optionIndex = argv.findIndex((word) => word.startsWith(OPTION_PREFIX));
  return optionIndex === -1 ? argv : argv.slice(0, optionIndex);
}

/** False when the word after the legacy words is a valid subcommand of the new noun. */
function isLegacyUse(row: IExaCtlRename, typed: readonly string[]): boolean {
  if (row.unlessNextIn === undefined) return true;
  const next = typed[row.legacy.length];
  return next !== undefined && !row.unlessNextIn.includes(next);
}

/** The row whose legacy words are the longest prefix of the typed words, or null. */
export function findRename(typed: readonly string[]): IExaCtlRename | null {
  let best: IExaCtlRename | null = null;
  for (const row of EXACTL_RENAMES) {
    const matches = row.legacy.length <= typed.length && row.legacy.every((word, index) => typed[index] === word);
    if (matches && isLegacyUse(row, typed) && (best === null || row.legacy.length > best.legacy.length)) best = row;
  }
  return best;
}

/** The one-line stderr hint for a rename row. */
export function renameHint(rename: IExaCtlRename, typed: readonly string[]): string {
  const isTemplate = rename.canonical.includes(USAGE_TEMPLATE_MARKER);
  const rest = isTemplate ? [] : typed
    .slice(rename.legacy.length)
    .map((word) => quoteArgument(word.slice(0, MAX_HINT_ECHO_CHARS)));
  const replacement = [rename.canonical, ...rest].join(" ");
  return `'exactl ${rename.legacy.join(" ")}' was renamed: use '${replacement}'`;
}

/** The option rename whose command path leads `argv` and whose legacy option appears before any `--`. */
export function findOptionRename(argv: readonly string[]): IExaCtlOptionRename | null {
  const words = leadingWords(argv);
  const terminator = argv.indexOf(OPTION_TERMINATOR);
  const options = (terminator === -1 ? argv : argv.slice(0, terminator))
    .slice(words.length)
    .map((token) => token.split(OPTION_VALUE_SEPARATOR)[0]);
  return EXACTL_OPTION_RENAMES.find((row) =>
    row.path.length <= words.length && row.path.every((word, index) => words[index] === word) &&
    options.includes(row.legacyOption)
  ) ?? null;
}

/** The one-line stderr hint for an option rename. */
export function optionRenameHint(rename: IExaCtlOptionRename): string {
  return `'exactl ${rename.path.join(" ")} ${rename.legacyOption}' was renamed: use '${rename.canonicalOption}'`;
}

/** The one-line stderr hint for free text typed straight after `exactl request`. */
export function requestCreateHint(typedWords: readonly string[]): string {
  return `'exactl ${REQUEST_NOUN} <text>' was removed: use 'exactl ${REQUEST_NOUN} ${CREATE_VERB} ${
    quoteForShell(typedWords.join(" "))
  }'`;
}
