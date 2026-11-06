/**
 * @module ExaCtlRenames
 * @path apps/exactl/src/exactl_renames.ts
 * @description The table of removed exactl command paths and the hint text that names the replacement.
 * @architectural-layer CLI
 * @dependencies []
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/tests/exactl_renames_test.ts]
 */

/** One removed command path and the path that replaces it. */
export interface IExaCtlRename {
  /** Old path words after `exactl`, such as `["blueprint", "ls"]`. */
  readonly legacy: readonly string[];
  /** New invocation shown to the user, such as `exactl blueprint list`. */
  readonly canonical: string;
}

/** Longest typed text that a hint echoes back. */
export const MAX_HINT_ECHO_CHARS = 200;

const SINGLE_QUOTE = "'";
const ESCAPED_SINGLE_QUOTE = `'\\''`;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const PLAIN_WORD = /^[\w./:=@%+,-]+$/;

export const EXACTL_RENAMES: readonly IExaCtlRename[] = [
  { legacy: ["blueprint", "agent-role"], canonical: "exactl blueprint" },
  { legacy: ["blueprint", "ls"], canonical: "exactl blueprint list" },
  { legacy: ["blueprint", "rm"], canonical: "exactl blueprint remove" },
];

/** The row whose legacy words are the longest prefix of the typed words, or null. */
export function findRename(typed: readonly string[]): IExaCtlRename | null {
  let best: IExaCtlRename | null = null;
  for (const row of EXACTL_RENAMES) {
    const matches = row.legacy.length <= typed.length && row.legacy.every((word, index) => typed[index] === word);
    if (matches && (best === null || row.legacy.length > best.legacy.length)) best = row;
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
  const rest = typed
    .slice(rename.legacy.length)
    .map((word) => PLAIN_WORD.test(word) ? word : quoteForShell(word));
  const replacement = [rename.canonical, ...rest].join(" ");
  return `'exactl ${rename.legacy.join(" ")}' was renamed: use '${replacement}'`;
}
