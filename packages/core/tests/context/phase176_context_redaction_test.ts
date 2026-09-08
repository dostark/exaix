/**
 * @module Phase176ContextRedactionTest
 * @path packages/core/tests/context/phase176_context_redaction_test.ts
 * @description Phase 176 Step 1: context_redaction strips terminal control bytes
 * (keeping tab/newline), redacts known configured secret values and recognizable
 * private-key/bearer-token blocks, and containsKnownSecret detects an unredactable
 * secret so the caller can abort rather than silently alter required instructions.
 * @architectural-layer Tests
 * @related-files [packages/core/src/func/context_redaction.ts]
 */

import { assertEquals } from "@std/assert";
import { containsKnownSecret, redactKnownSecrets, stripTerminalControlBytes } from "@exaix/core/func";

Deno.test("[stripTerminalControlBytes] keeps tab and newline", () => {
  const input = "line one\tindented\nline two";
  assertEquals(stripTerminalControlBytes(input), input);
});

Deno.test("[stripTerminalControlBytes] removes an ANSI escape sequence", () => {
  const input = "before\x1b[31mred\x1b[0mafter";
  assertEquals(stripTerminalControlBytes(input), "before[31mred[0mafter");
});

Deno.test("[stripTerminalControlBytes] removes NUL and DEL bytes", () => {
  const input = "a\x00b\x7Fc";
  assertEquals(stripTerminalControlBytes(input), "abc");
});

Deno.test("[redactKnownSecrets] redacts every occurrence of a known secret value", () => {
  const result = redactKnownSecrets("token=sk-abc123 and again sk-abc123 here", ["sk-abc123"]);
  assertEquals(result.text, "token=[REDACTED] and again [REDACTED] here");
  assertEquals(result.redactedCount, 2);
});

Deno.test("[redactKnownSecrets] leaves text unchanged when no secret is present", () => {
  const result = redactKnownSecrets("nothing sensitive here", ["sk-abc123"]);
  assertEquals(result.text, "nothing sensitive here");
  assertEquals(result.redactedCount, 0);
});

Deno.test("[redactKnownSecrets] ignores empty-string entries in knownSecrets", () => {
  const result = redactKnownSecrets("some text", ["", "not-present"]);
  assertEquals(result.text, "some text");
  assertEquals(result.redactedCount, 0);
});

Deno.test("[redactKnownSecrets] redacts a PEM private-key block", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
  const result = redactKnownSecrets(`before ${pem} after`, []);
  assertEquals(result.text, "before [REDACTED] after");
  assertEquals(result.redactedCount, 1);
});

Deno.test("[redactKnownSecrets] redacts a Bearer token", () => {
  const result = redactKnownSecrets("Authorization: Bearer abc123.def456-ghi", []);
  assertEquals(result.text, "Authorization: [REDACTED]");
  assertEquals(result.redactedCount, 1);
});

Deno.test("[redactKnownSecrets] applies both known-secret and pattern-based redaction together", () => {
  const result = redactKnownSecrets("secret=my-secret-value, also Bearer xyz789", ["my-secret-value"]);
  assertEquals(result.text, "secret=[REDACTED], also [REDACTED]");
  assertEquals(result.redactedCount, 2);
});

Deno.test("[containsKnownSecret] returns true when a known secret is present", () => {
  assertEquals(containsKnownSecret("contains sk-abc123 here", ["sk-abc123"]), true);
});

Deno.test("[containsKnownSecret] returns false when no known secret is present", () => {
  assertEquals(containsKnownSecret("nothing sensitive here", ["sk-abc123"]), false);
});

Deno.test("[containsKnownSecret] ignores empty-string entries", () => {
  assertEquals(containsKnownSecret("any text", [""]), false);
});
