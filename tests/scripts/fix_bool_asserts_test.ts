/**
 * @module FixBoolAssertsTest
 * @path tests/scripts/fix_bool_asserts_test.ts
 * @description Behaviour of the typed boolean-assertion codemod (deslop, MIT).
 * @architectural-layer Test
 * @related-files [scripts/fix_bool_asserts.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fixSourceText } from "../../scripts/fix_bool_asserts.ts";

const FILE = "packages/x/tests/a_test.ts";

Deno.test("a string subject becomes assertStringIncludes", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.includes("b"), true);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertStringIncludes(s, "b")');
});

Deno.test("an array subject becomes assertArrayIncludes with a wrapped element", () => {
  const result = fixSourceText(FILE, "const arr: number[] = [1];\nassertEquals(arr.includes(1), true);\n");
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "assertArrayIncludes(arr, [1])");
});

Deno.test("a union subject is left unchanged and listed", () => {
  const source = 'declare const u: string | string[];\nassertEquals(u.includes("b"), true);\n';
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 0);
  assertEquals(result.text, source);
  assertEquals(result.skipped.length, 1);
});

Deno.test("a false boolean argument becomes a negated assertion", () => {
  // The codemod first left `false` unchanged, and now rewrites it to assertFalse.
  const source = 'const s: string = "abc";\nassertEquals(s.includes("b"), false);\n';
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertFalse(s.includes("b"))');
});

Deno.test("startsWith becomes an anchored assertMatch pattern", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.startsWith("a"), true);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "assertMatch(s, /^a/)");
});

Deno.test("endsWith becomes an anchored assertMatch pattern", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.endsWith("c"), true);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "assertMatch(s, /c$/)");
});

Deno.test("a match argument containing a newline stays a valid regex literal", () => {
  const result = fixSourceText(FILE, 'const s: string = "x";\nassertEquals(s.startsWith("---\\n"), true);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "assertMatch(s, /^---\\n/)");
});

Deno.test("a match argument containing a slash stays a valid regex literal", () => {
  const result = fixSourceText(FILE, 'const s: string = "x";\nassertEquals(s.endsWith(",dst=/tmp/.local"), true);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "assertMatch(s, /,dst=\\/tmp\\/\\.local$/)");
});

Deno.test("a match argument escapes regular-expression metacharacters", () => {
  const result = fixSourceText(FILE, 'const s: string = "x";\nassertEquals(s.startsWith("a.b"), true);\n');
  assertStringIncludes(result.text, "assertMatch(s, /^a\\.b/)");
});

Deno.test("a trailing message argument is kept", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.includes("b"), true, "why");\n');
  assertStringIncludes(result.text, 'assertStringIncludes(s, "b", "why")');
});

Deno.test("the codemod is idempotent", () => {
  const source = 'const s: string = "abc";\nassertEquals(s.includes("b"), true);\n';
  const once = fixSourceText(FILE, source);
  const twice = fixSourceText(FILE, once.text);
  assertEquals(twice.changed, 0);
  assertEquals(twice.text, once.text);
});

Deno.test("a false substring assertion becomes assertFalse", () => {
  const result = fixSourceText(FILE, 'const s: string = "x";\nassertEquals(s.includes("a"), false);\n');
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertFalse(s.includes("a"))');
});

Deno.test("a false assertion rewrites without the subject type", () => {
  const result = fixSourceText(
    FILE,
    'declare const raw: unknown;\nassertEquals((raw as string).startsWith("a"), false, "why");\n',
  );
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertFalse((raw as string).startsWith("a"), "why")');
});

Deno.test("a true assertion still needs a statically-typed subject", () => {
  const result = fixSourceText(
    FILE,
    'declare const raw: unknown;\nassertEquals((raw as number).includes("a"), true);\n',
  );
  assertEquals(result.changed, 0);
});
