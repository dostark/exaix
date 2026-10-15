/**
 * @module FixBoolAssertsTest
 * @path tests/scripts/fix_bool_asserts_test.ts
 * @description Behaviour of the typed boolean-assertion codemod (deslop, MIT).
 * @architectural-layer Test
 * @related-files [scripts/fix_bool_asserts.ts]
 */

import { assertEquals } from "@std/assert";
import { fixSourceText } from "../../scripts/fix_bool_asserts.ts";

const FILE = "packages/x/tests/a_test.ts";

Deno.test("a string subject becomes assertStringIncludes", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.includes("b"), true);\n');
  assertEquals(result.changed, 1);
  assertEquals(result.text.includes('assertStringIncludes(s, "b")'), true);
});

Deno.test("an array subject becomes assertArrayIncludes with a wrapped element", () => {
  const result = fixSourceText(FILE, "const arr: number[] = [1];\nassertEquals(arr.includes(1), true);\n");
  assertEquals(result.changed, 1);
  assertEquals(result.text.includes("assertArrayIncludes(arr, [1])"), true);
});

Deno.test("a union subject is left unchanged and listed", () => {
  const source = 'declare const u: string | string[];\nassertEquals(u.includes("b"), true);\n';
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 0);
  assertEquals(result.text, source);
  assertEquals(result.skipped.length, 1);
});

Deno.test("a false boolean argument is left unchanged and listed", () => {
  const source = 'const s: string = "abc";\nassertEquals(s.includes("b"), false);\n';
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 0);
  assertEquals(result.text, source);
});

Deno.test("startsWith becomes an anchored assertMatch pattern", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.startsWith("a"), true);\n');
  assertEquals(result.changed, 1);
  assertEquals(result.text.includes("assertMatch(s, /^a/)"), true);
});

Deno.test("endsWith becomes an anchored assertMatch pattern", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.endsWith("c"), true);\n');
  assertEquals(result.changed, 1);
  assertEquals(result.text.includes("assertMatch(s, /c$/)"), true);
});

Deno.test("a match argument escapes regular-expression metacharacters", () => {
  const result = fixSourceText(FILE, 'const s: string = "x";\nassertEquals(s.startsWith("a.b"), true);\n');
  assertEquals(result.text.includes("assertMatch(s, /^a\\.b/)"), true);
});

Deno.test("a trailing message argument is kept", () => {
  const result = fixSourceText(FILE, 'const s: string = "abc";\nassertEquals(s.includes("b"), true, "why");\n');
  assertEquals(result.text.includes('assertStringIncludes(s, "b", "why")'), true);
});

Deno.test("the codemod is idempotent", () => {
  const source = 'const s: string = "abc";\nassertEquals(s.includes("b"), true);\n';
  const once = fixSourceText(FILE, source);
  const twice = fixSourceText(FILE, once.text);
  assertEquals(twice.changed, 0);
  assertEquals(twice.text, once.text);
});
