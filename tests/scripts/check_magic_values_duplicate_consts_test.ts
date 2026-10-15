/**
 * @module CheckMagicValuesDuplicateConstsTest
 * @path tests/scripts/check_magic_values_duplicate_consts_test.ts
 * @description Cross-file duplicate named-constant detection for check_magic_values.ts (deslop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/exaix/check_magic_values.ts]
 */

import { assertEquals } from "@std/assert";
import {
  findDuplicateConstants,
  validateConstantAllowEntries,
} from "../../packages/lint-rules/src/exaix/check_magic_values.ts";

const A = "packages/a/src/a.ts";
const B = "packages/b/src/b.ts";
const C = "packages/c/src/c.ts";

function files(entries: Record<string, string>) {
  return Object.entries(entries).map(([path, text]) => ({ path, text }));
}

Deno.test("duplicate constants report the later file and the first file", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MAX_RETRIES = 3;\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
  assertEquals(found[0].name, "MAX_RETRIES");
  assertEquals(found[0].firstFile, A);
  assertEquals(found[0].laterFile, B);
});

Deno.test("a different value is not a duplicate", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MAX_RETRIES = 4;\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("a different name with the same value is not a duplicate", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MIN_RETRIES = 3;\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("an allowlisted pair is not reported", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MAX_RETRIES = 3;\n",
    }),
    { allow: [{ name: "MAX_RETRIES", files: [A, B], reason: "Package isolation." }] },
  );
  assertEquals(found.length, 0);
});

Deno.test("an allow entry that matches no duplicate is rejected", () => {
  const errors = validateConstantAllowEntries(
    files({ [A]: "export const OTHER = 1;\n" }),
    { allow: [{ name: "MISSING", files: [A, C], reason: "No longer real." }] },
  );
  assertEquals(errors.length, 1);
});
