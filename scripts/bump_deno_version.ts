#!/usr/bin/env -S deno run -A
/**
 * @module BumpDenoVersion
 * @path scripts/bump_deno_version.ts
 *
 * Usage:
 *   deno task deno:bump 2.9.9                       # the registered form
 *   deno run --allow-read --allow-write scripts/bump_deno_version.ts 2.9.9   # direct
 *
 * @description Moves the single Deno pin of the Docker image. The `ARG DENO_VERSION` default in the
 *   Dockerfile is the only place that holds the number: every stage reads it, and the documents name the
 *   argument instead of a version. The script rewrites the default, checks the pin rules and prints the
 *   validation steps. Per standing project instruction, the drift test in `tests/scripts` enforces the pin and no
 *   CI job or pre-commit gate runs this script.
 * @architectural-layer Script
 * @dependencies [@std/path]
 * @related-files [tests/scripts/deno_version_pin_test.ts, Dockerfile, ARCHITECTURE.md]
 */

import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const ARGUMENT_NAME = "DENO_VERSION";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const ARGUMENT_LINE = /^ARG DENO_VERSION=(\d+\.\d+\.\d+)$/m;
const IMAGE_LINE = /^FROM\s+(?:docker\.io\/)?denoland\/deno:(\S+)/gm;
const NUMBERED_IMAGE = /denoland\/deno:\d/;
const USAGE_EXIT = 2;
const CHECKLIST: readonly string[] = [
  "Read the Deno release notes between the old and the new version.",
  "Run `deno task test_all` so the containered batch runs on the new image.",
  "Check `git status` for a rewritten deno.json or deno.lock, and commit only a deliberate change.",
];

/** The version in the Dockerfile argument default, or null when the argument is missing or not x.y.z. */
export function pinnedDenoVersion(dockerfile: string): string | null {
  return ARGUMENT_LINE.exec(dockerfile)?.[1] ?? null;
}

/** The Dockerfile text with the argument default replaced by `version`. */
export function withDenoVersion(dockerfile: string, version: string): string {
  if (!EXACT_VERSION.test(version)) throw new Error(`the Deno version must be exact x.y.z, not '${version}'`);
  if (pinnedDenoVersion(dockerfile) === null) throw new Error(`the Dockerfile defines no ARG ${ARGUMENT_NAME}=x.y.z`);
  return dockerfile.replace(ARGUMENT_LINE, `ARG ${ARGUMENT_NAME}=${version}`);
}

/** The pin rules the Dockerfile and the named documents break, one sentence each. */
export function denoPinProblems(dockerfile: string, documents: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  if (pinnedDenoVersion(dockerfile) === null) problems.push(`the Dockerfile defines no ARG ${ARGUMENT_NAME}=x.y.z`);
  for (const match of dockerfile.matchAll(IMAGE_LINE)) {
    if (match[1].startsWith(`\${${ARGUMENT_NAME}}`)) continue;
    problems.push(`a Dockerfile stage pins the literal tag '${match[1]}' instead of \${${ARGUMENT_NAME}}`);
  }
  for (const [name, text] of Object.entries(documents)) {
    if (NUMBERED_IMAGE.test(text)) problems.push(`${name} repeats a Deno image version; name ${ARGUMENT_NAME} instead`);
  }
  return problems;
}

/** Rewrites the Dockerfile pin and prints what to do next. */
async function main(): Promise<void> {
  const version = Deno.args[0] ?? "";
  if (!EXACT_VERSION.test(version)) {
    console.error("Usage: deno task deno:bump <x.y.z>");
    Deno.exit(USAGE_EXIT);
  }
  const path = join(REPO_ROOT, "Dockerfile");
  const before = await Deno.readTextFile(path);
  const previous = pinnedDenoVersion(before);
  await Deno.writeTextFile(path, withDenoVersion(before, version));
  console.log(`Deno image pin: ${previous ?? "none"} -> ${version}`);
  for (const step of CHECKLIST) console.log(`  - ${step}`);
}

if (import.meta.main) await main();
