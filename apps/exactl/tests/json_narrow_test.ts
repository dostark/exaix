/**
 * @module JsonNarrowTest
 * @path apps/exactl/tests/json_narrow_test.ts
 * @description Verifies that stringOf, numberOf and objectOf read only the shape that they name and give undefined for every other value.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core, apps/exactl/src/output/json_narrow.ts]
 * @related-files [apps/exactl/src/output/json_narrow.ts, apps/exactl/src/output/exactl_output.ts]
 */

import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core/types";
import { numberOf, objectOf, stringOf } from "../src/output/json_narrow.ts";

const NON_STRINGS: ReadonlyArray<JSONValue | undefined> = [1, true, null, undefined, [], {}];
const NON_NUMBERS: ReadonlyArray<JSONValue | undefined> = ["1", true, null, undefined, [], {}, Number.NaN];
const NON_OBJECTS: ReadonlyArray<JSONValue | undefined> = ["text", 1, true, null, undefined, ["a"]];

Deno.test("stringOf gives a string, including the empty string, and undefined for any other value", () => {
  assertEquals(stringOf("text"), "text");
  assertEquals(stringOf(""), "");
  assertEquals(NON_STRINGS.map((value) => stringOf(value)), NON_STRINGS.map(() => undefined));
});

Deno.test("numberOf gives a number, including zero, and undefined for a string, NaN or any other value", () => {
  assertEquals(numberOf(3.5), 3.5);
  assertEquals(numberOf(0), 0);
  assertEquals(NON_NUMBERS.map((value) => numberOf(value)), NON_NUMBERS.map(() => undefined));
});

Deno.test("objectOf gives a plain object and undefined for an array, null or a primitive", () => {
  assertEquals(objectOf({ a: 1, b: "x" }), { a: 1, b: "x" });
  assertEquals(objectOf({}), {});
  assertEquals(NON_OBJECTS.map((value) => objectOf(value)), NON_OBJECTS.map(() => undefined));
});
