/**
 * @module LintPolicyLocalCutoverTest
 * @path tests/scripts/lint_policy_local_cutover_test.ts
 * @description Guards the local cutover after the remediation steps: no rule ceiling rose since the first cutover and the engine checkout matches the recorded pointer.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/rule_ceilings.json, tests/scripts/rule_ceiling_ratchet_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const CEILINGS_PATH = "packages/lint-policy/rule_ceilings.json";
const FIRST_CUTOVER_COMMIT = "772fbc96c081baedec792cf77bb5eb2b7f27bf75";
const ENGINE_SUBMODULE = "unslop-ts";
const GITLINK_FIELDS = 3;

type Ceilings = Readonly<Record<string, Readonly<Record<string, number>>>>;

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const result = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder();
  assert(result.success, `git ${args.join(" ")} failed: ${text.decode(result.stderr)}`);
  return text.decode(result.stdout);
}

function raisedCeilings(before: Ceilings, after: Ceilings): string[] {
  const raised: string[] = [];
  for (const [rule, buckets] of Object.entries(after)) {
    for (const [bucket, ceiling] of Object.entries(buckets)) {
      const previous = before[rule]?.[bucket];
      if (previous === undefined || ceiling > previous) {
        raised.push(`${rule} ${bucket}: ${previous ?? "none"} -> ${ceiling}`);
      }
    }
  }
  return raised;
}

Deno.test("phase227_remediation_cutover", async () => {
  const before: Ceilings = JSON.parse(await gitOutput(REPO_ROOT, "show", `${FIRST_CUTOVER_COMMIT}:${CEILINGS_PATH}`));
  const after: Ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, CEILINGS_PATH)));
  assertEquals(raisedCeilings(before, after), []);
  assert(Object.keys(after).length > 0, "the ceiling table is empty");

  const staged = (await gitOutput(REPO_ROOT, "ls-files", "-s", ENGINE_SUBMODULE)).trim().split(/\s+/);
  assertEquals(staged.length >= GITLINK_FIELDS, true);
  const checkedOut = (await gitOutput(join(REPO_ROOT, ENGINE_SUBMODULE), "rev-parse", "HEAD")).trim();
  assertEquals(staged[1], checkedOut, "the engine checkout differs from the recorded pointer");
  assertEquals((await gitOutput(join(REPO_ROOT, ENGINE_SUBMODULE), "status", "--porcelain")).trim(), "");
});

Deno.test("the ceiling guard reports a raised and a new bucket", () => {
  const before: Ceilings = { "exaix/a": { "packages/x": 3 } };
  const after: Ceilings = { "exaix/a": { "packages/x": 4, "packages/y": 1 }, "exaix/b": { "tests": 2 } };
  assertEquals(raisedCeilings(before, after), [
    "exaix/a packages/x: 3 -> 4",
    "exaix/a packages/y: none -> 1",
    "exaix/b tests: none -> 2",
  ]);
  assertEquals(raisedCeilings(after, before), []);
});
