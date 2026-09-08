/**
 * @module ContextRedaction
 * @path packages/core/src/func/context_redaction.ts
 * @description Bounded defense-in-depth for retrieved context before it is sent to a
 * child or captured to disk: strips terminal control bytes and redacts known configured
 * credential values plus recognizable private-key/bearer-token blocks. This is not a
 * claim that arbitrary text can be proven secret-free.
 * @architectural-layer Core
 * @related-files [packages/core/src/func/context_items.ts]
 */

export interface IRedactionResult {
  text: string;
  redactedCount: number;
}

const REDACTION_MARKER = "[REDACTED]";

const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g;

// deno-lint-ignore no-control-regex
const TERMINAL_CONTROL_BYTE_PATTERN = /[\x00-\x08\x0B-\x1F\x7F]/g;

/** Removes terminal control bytes (keeping tab/newline) from text before it is rendered
 *  in a terminal or sent to a child — a bounded defense against escape-sequence injection. */
export function stripTerminalControlBytes(text: string): string {
  return text.replace(TERMINAL_CONTROL_BYTE_PATTERN, "");
}

/** Returns true if `text` contains any of `knownSecrets` verbatim. Used to decide whether
 *  the original objective/acceptance criteria must abort rather than be silently altered. */
export function containsKnownSecret(text: string, knownSecrets: readonly string[]): boolean {
  return knownSecrets.some((secret) => secret.length > 0 && text.includes(secret));
}

/** Redacts every occurrence of each `knownSecrets` value, then recognizable private-key
 *  and bearer-token blocks. Pure: takes the secret values as input, never reads env/config. */
export function redactKnownSecrets(text: string, knownSecrets: readonly string[]): IRedactionResult {
  let result = text;
  let redactedCount = 0;

  for (const secret of knownSecrets) {
    if (secret.length === 0) continue;
    const parts = result.split(secret);
    if (parts.length === 1) continue;
    redactedCount += parts.length - 1;
    result = parts.join(REDACTION_MARKER);
  }

  for (const pattern of [PRIVATE_KEY_BLOCK_PATTERN, BEARER_TOKEN_PATTERN]) {
    result = result.replace(pattern, () => {
      redactedCount++;
      return REDACTION_MARKER;
    });
  }

  return { text: result, redactedCount };
}
