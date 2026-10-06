/**
 * @module SkillFolderSecurityTest
 * @path packages/core/tests/skills/skill_folder_security_test.ts
 * @description Phase 206 Step 1 — rejection-by-validation tests for the pure parser.
 *   Rejects NUL and lone CR bytes, normalizes CRLF to LF, and preserves multibyte
 *   content so a digest never depends on host line endings.
 * @architectural-layer Security
 * @dependencies [@std/assert, @exaix/core/skills]
 * @related-files [packages/core/src/skills/skill_snapshot.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { canonicalizeSkillText, computeSkillContentSha256, type ISkillRevisionSnapshot } from "@exaix/core/skills";

function snapshot(skillMd: string): ISkillRevisionSnapshot {
  return { skill_md: skillMd, exaix_yaml: null, references: [] };
}

Deno.test("[security] parser rejects a NUL byte", () => {
  assertThrows(() => canonicalizeSkillText("a\0b"));
});

Deno.test("[security] parser rejects a lone CR byte", () => {
  assertThrows(() => canonicalizeSkillText("a\rb"));
});

Deno.test("[security] parser normalizes CRLF to LF", () => {
  assertEquals(canonicalizeSkillText("a\r\nb\r\n"), "a\nb");
});

Deno.test("[security] multibyte content survives canonicalization and hashes stably", async () => {
  const text = "---\nname: code-review\ndescription: コードレビュー ✓\n---\n本文 🔒\n";
  assertEquals(canonicalizeSkillText(text).includes("🔒"), true);
  assertEquals(canonicalizeSkillText(text).includes("コードレビュー"), true);
  const lf = await computeSkillContentSha256(snapshot(text));
  const crlf = await computeSkillContentSha256(snapshot(text.replace(/\n/g, "\r\n")));
  assertEquals(lf, crlf);
});
