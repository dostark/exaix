/**
 * @module VerificationOutput
 * @path packages/execution/src/verification_output.ts
 * @description Shared child-environment and check-output handling for both verification kinds.
 * @architectural-layer Services
 * @dependencies [@exaix/core]
 * @related-files [packages/execution/src/verification_runner.ts, packages/execution/src/unslop_check_runner.ts]
 */

import { buildChildEnv, VERIFICATION_DENO_ENV_KEYS } from "@exaix/core";
import { redactKnownSecrets } from "@exaix/core/func";

/** Escape character that opens an ANSI terminal sequence. */
const ESCAPE_CHAR = String.fromCharCode(0x1b);
/** ANSI CSI sequences (colors, cursor moves) that coloured tool output emits. */
const ANSI_CSI_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-?]*[ -/]*[@-~]`, "g");
/** First printable character code. Lower codes are control characters. */
const FIRST_PRINTABLE_CHAR_CODE = 0x20;
/** DEL, the only control character above the printable range. */
const DELETE_CHAR_CODE = 0x7f;
/** Whitespace control characters agent input validation accepts. */
const ALLOWED_CONTROL_CHARS = new Set(["\t", "\n", "\r"]);
/** The `<` that opens a markup tag agent input validation rejects. */
const REJECTED_TAG_OPENING_PATTERN = /<(?=\/?(?:script|iframe|img)\b)/gi;
const ESCAPED_LESS_THAN = "&lt;";

/** Build the allowlist child env plus only the deno cache keys from the daemon env. */
export function buildVerificationCheckEnv(): { env: Record<string, string>; clearEnv: boolean } {
  const daemonEnv = Deno.env.toObject();
  const overlay: Record<string, string> = {};
  for (const key of VERIFICATION_DENO_ENV_KEYS) {
    const value = daemonEnv[key];
    if (value !== undefined) overlay[key] = value;
  }
  return buildChildEnv({ mode: "allowlist", env: overlay });
}

/** Make check output safe to embed in an agent prompt. Removes ANSI escapes and control
 *  characters, and escapes the markup tags that agent input validation rejects. */
export function sanitizeVerificationOutput(output: string): string {
  const withoutAnsi = output.replace(ANSI_CSI_PATTERN, "");
  const printable = [...withoutAnsi].filter((char) => {
    const code = char.charCodeAt(0);
    if (ALLOWED_CONTROL_CHARS.has(char)) return true;
    return code >= FIRST_PRINTABLE_CHAR_CODE && code !== DELETE_CHAR_CODE;
  }).join("");
  return printable.replace(REJECTED_TAG_OPENING_PATTERN, ESCAPED_LESS_THAN);
}

/** Redact known secrets, sanitize the text, then keep only the last `maxChars` characters. */
export function prepareVerificationOutput(
  output: string,
  maxChars: number,
  knownSecrets: readonly string[],
): string {
  const redacted = redactKnownSecrets(sanitizeVerificationOutput(output), knownSecrets).text;
  return redacted.length > maxChars ? redacted.slice(redacted.length - maxChars) : redacted;
}
