/**
 * @module CheckCodeStyleDuplicateTypesTest
 * @path tests/scripts/check_code_style_duplicate_types_test.ts
 * @description Cross-file duplicate type-contract detection for check_code_style.ts (deslop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import {
  findDuplicateTypes,
  validateTypeAllowEntries,
} from "../../packages/lint-policy/src/checkers/check_code_style.ts";

const A = "packages/a/src/i_a.ts";
const B = "packages/b/src/i_b.ts";
const C = "packages/c/src/i_c.ts";

function files(entries: Record<string, string>) {
  return Object.entries(entries).map(([path, text]) => ({ path, text }));
}

Deno.test("duplicate types report the later file and the first file", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
  assertEquals(found[0].name, "IThing");
  assertEquals(found[0].firstFile, A);
  assertEquals(found[0].laterFile, B);
});

Deno.test("member order does not matter", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { b: number; a: string; }\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
});

Deno.test("readonly spacing does not matter", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { readonly a: string; b: number; }\n",
      [B]: "export interface IThing { readonly  a: string;\n  b: number; }\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
});

Deno.test("a one-member interface is not reported under the default minProperties", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; }\n",
      [B]: "export interface IThing { a: string; }\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
  const relaxed = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; }\n",
      [B]: "export interface IThing { a: string; }\n",
    }),
    { minProperties: 1 },
  );
  assertEquals(relaxed.length, 1);
});

Deno.test("a different member type is not a duplicate", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: string; }\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("an object type alias with the same members is reported", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export type TThing = { a: string; b: number };\n",
      [B]: "export type TThing = { a: string; b: number };\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
});

Deno.test("an interface with extends is compared on its own members", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing extends IBase { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
});

Deno.test("an allowlisted pair is not reported", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    { allow: [{ name: "IThing", files: [A, B], reason: "Edition boundary." }] },
  );
  assertEquals(found.length, 0);
});

Deno.test("an allow entry that matches no duplicate is rejected", () => {
  const errors = validateTypeAllowEntries(
    files({ [A]: "export interface IOther { a: string; b: number; }\n" }),
    { allow: [{ name: "IMISSING", files: [A, C], reason: "No longer real." }] },
  );
  assertEquals(errors.length, 1);
});
