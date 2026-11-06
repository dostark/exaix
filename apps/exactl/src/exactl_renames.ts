/**
 * @module ExaCtlRenames
 * @path apps/exactl/src/exactl_renames.ts
 * @description The table of removed exactl command paths and the hint text that names the replacement.
 * @architectural-layer CLI
 * @dependencies []
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/tests/exactl_renames_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/** One removed command path and the path that replaces it. */
export interface IExaCtlRename {
  /** Old path words after `exactl`, such as `["blueprint", "ls"]`. */
  readonly legacy: readonly string[];
  /** New invocation shown to the user, such as `exactl blueprint list`. A text with `<placeholders>` is a usage template. */
  readonly canonical: string;
  /** Set where the legacy leaf became a noun. The row skips a next word that is a valid subcommand. */
  readonly unlessNextIn?: Opt<readonly string[], Reason.OptionalInput>;
}

/** Longest typed text that a hint echoes back. */
export const MAX_HINT_ECHO_CHARS = 200;

const SINGLE_QUOTE = "'";
const ESCAPED_SINGLE_QUOTE = `'\\''`;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LEGACY_JOURNAL = "journal";
const LEGACY_MEMORY = "memory";
const LEGACY_CONFIG = "config";
const LEGACY_PLAN = "plan";
const LEGACY_PORTAL = "portal";
const USAGE_TEMPLATE_MARKER = "<";
const PLAIN_WORD = /^[\w./:=@%+,-]+$/;

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
  { legacy: ["mcp", "start"], canonical: "exactl mcp serve" },
  {
    legacy: ["mcp", "connect"],
    canonical: "exactl mcp tool list --server <url>, or exactl mcp tool call <tool> --server <url>",
  },
];

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

/** Quotes text for a POSIX shell. Control characters go and long text is cut. */
export function quoteForShell(text: string): string {
  const clean = text.replace(CONTROL_CHARACTERS, "").slice(0, MAX_HINT_ECHO_CHARS);
  return `${SINGLE_QUOTE}${clean.replaceAll(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}${SINGLE_QUOTE}`;
}

/** The one-line stderr hint for a rename row. */
export function renameHint(rename: IExaCtlRename, typed: readonly string[]): string {
  const isTemplate = rename.canonical.includes(USAGE_TEMPLATE_MARKER);
  const rest = isTemplate ? [] : typed
    .slice(rename.legacy.length)
    .map((word) => PLAIN_WORD.test(word) ? word : quoteForShell(word));
  const replacement = [rename.canonical, ...rest].join(" ");
  return `'exactl ${rename.legacy.join(" ")}' was renamed: use '${replacement}'`;
}
