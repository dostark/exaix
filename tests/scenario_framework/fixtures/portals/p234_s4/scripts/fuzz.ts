#!/usr/bin/env -S deno run -A
/**
 * @module FuzzFixture
 * @path tests/scenario_framework/fixtures/portals/p234_s4/scripts/fuzz.ts
 * @description Explores malformed tokens with a fixed seed and bounded cases.
 * @architectural-layer Test
 * @related-files [../src/parser.ts]
 */
import { parseToken } from "../src/parser.ts";

const seed = 7;
const cases = ["a=1", "=1", "a=", "a", "a=1=2", ""];
const failures: string[] = [];
for (const input of cases) {
  try {
    parseToken(input);
  } catch {
    failures.push(input);
  }
}
console.log(JSON.stringify({ seed, cases: cases.length, failures }));
