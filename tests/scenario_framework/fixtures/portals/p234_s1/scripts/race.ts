#!/usr/bin/env -S deno run -A
/**
 * @module RaceFixture
 * @path tests/scenario_framework/fixtures/portals/p234_s1/scripts/race.ts
 * @description Repeats the two-caller race and reports the duplicate frequency.
 * @architectural-layer Test
 * @related-files [../src/race_writer.ts]
 */
import { insertOnce } from "../src/race_writer.ts";

/** Reads one numeric flag. */
function readNumber(flag: string, fallback: number): number {
  const index = Deno.args.indexOf(flag);
  if (index < 0) return fallback;
  return Number(Deno.args[index + 1]);
}

const attempts = readNumber("--attempts", 20);
const seed = readNumber("--seed", 42);
const delayMs = (seed % 7) + 1;
let duplicateRuns = 0;

for (let attempt = 0; attempt < attempts; attempt++) {
  const store: string[] = [];
  await Promise.all([
    insertOnce(store, "row").then(() => new Promise((resolve) => setTimeout(resolve, delayMs))),
    insertOnce(store, "row").then(() => new Promise((resolve) => setTimeout(resolve, delayMs))),
  ]);
  if (store.length > 1) duplicateRuns++;
}

console.log(JSON.stringify({ attempts, duplicateRuns, frequency: duplicateRuns / attempts }));
