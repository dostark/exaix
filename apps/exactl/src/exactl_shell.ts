/**
 * @module ExaCtlShell
 * @path apps/exactl/src/exactl_shell.ts
 * @description Shell quoting of the text that exactl prints inside a command: one word per text, control characters removed, long text cut.
 * @architectural-layer CLI
 * @dependencies []
 * @related-files [apps/exactl/src/exactl_renames.ts, apps/exactl/src/commands/approval_sources.ts, apps/exactl/src/commands/approval_id.ts]
 */

/** Longest typed text that a hint echoes back. */
export const MAX_HINT_ECHO_CHARS = 200;

const SINGLE_QUOTE = "'";
const ESCAPED_SINGLE_QUOTE = `'\\''`;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const PLAIN_WORD = /^[\w./:=@%+,-]+$/;

/** One shell word for the text. A plain word stays as it is, any other text is single quoted, and control characters go. */
export function quoteArgument(text: string): string {
  const clean = text.replace(CONTROL_CHARACTERS, "");
  return PLAIN_WORD.test(clean)
    ? clean
    : `${SINGLE_QUOTE}${clean.replaceAll(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}${SINGLE_QUOTE}`;
}

/** Quotes text for a POSIX shell. Control characters go and long text is cut. */
export function quoteForShell(text: string): string {
  const clean = text.replace(CONTROL_CHARACTERS, "").slice(0, MAX_HINT_ECHO_CHARS);
  return `${SINGLE_QUOTE}${clean.replaceAll(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}${SINGLE_QUOTE}`;
}
