/**
 * @module LintPolicyLocalCutoverTest
 * @path packages/lint-policy/tests/lint_policy_local_cutover_test.ts
 * @description Guards the local cutover after the remediation steps: no rule ceiling rose since the first cutover and the engine checkout matches the recorded pointer.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/rule_ceilings.json, packages/lint-policy/tests/rule_ceilings_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const CEILINGS_PATH = "packages/lint-policy/rule_ceilings.json";
/** The production-only ratchet starts at this cut-over commit. Earlier values mixed test scope. */
const FIRST_CUTOVER_COMMIT = "3467f53ccf95b9664514294c45f26a1df6ba8fa5";
/** The three complexity rules enter the ceiling table at this commit, so their ceilings start here. */
const COMPLEXITY_CUTOVER_COMMIT = "84d370479037b8c56e4a14e94de57fc074cf5c75";
/** The burn-down rules move to complete test-inclusive buckets at this commit. Later rises still fail. */
const COMPLETE_BUCKET_COMMIT = "cd62d9f2b618a9d4c891c12c6b0d5a7b74ff890d";
/** The Team ceilings after four packages joined the lint workspace. Rises beyond them still fail. */
const TEAM_COVERAGE_CEILINGS: Ceilings = {
  "exaix/require-safety-comment": { "exaix-team": 71 },
  "exaix/no-runtime-typeof": { "exaix-team": 19 },
  "exaix/no-conditional-empty-object-spread": { "exaix-team": 6 },
  "exaix/no-boolean-assert": { "exaix-team": 121 },
};
/** The class-size ceilings at the God Class cutover, when `exaix/max-class-size` joined the table. Rises beyond them still fail. */
const GOD_CLASS_CUTOVER_CEILINGS: Ceilings = {
  "exaix/max-class-size": {
    "apps/exactl": 8,
    "apps/tui": 5,
    "exaix-team/packages/mcp-server": 1,
    "packages/ai": 4,
    "packages/cli": 1,
    "packages/core": 5,
    "packages/execution": 4,
    "packages/flow": 2,
    "packages/git": 1,
    "packages/memory": 3,
    "packages/session": 1,
    "packages/storage-sqlite": 1,
    "packages/tool-runtime": 1,
    "packages/tui": 2,
  },
};
/** The module size ceilings at the first measurement, when `exaix/max-file-lines` joined the table. Rises beyond them still fail. */
const MODULE_SIZE_CUTOVER_CEILINGS: Ceilings = {
  "exaix/max-file-lines": {
    "apps/exactl": 4,
    "apps/tui": 3,
    "packages/ai": 2,
    "packages/cli": 1,
    "packages/core": 3,
    "packages/execution": 4,
    "packages/flow": 1,
    "packages/git": 1,
    "packages/memory": 1,
    "packages/request": 1,
    "packages/schemas": 1,
    "packages/tool-runtime": 1,
  },
};
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
  const first: Ceilings = JSON.parse(await gitOutput(REPO_ROOT, "show", `${FIRST_CUTOVER_COMMIT}:${CEILINGS_PATH}`));
  const complexity: Ceilings = JSON.parse(
    await gitOutput(REPO_ROOT, "show", `${COMPLEXITY_CUTOVER_COMMIT}:${CEILINGS_PATH}`),
  );
  const introduced = Object.fromEntries(Object.entries(complexity).filter(([rule]) => !(rule in first)));
  const migrated: Ceilings = JSON.parse(
    await gitOutput(REPO_ROOT, "show", `${COMPLETE_BUCKET_COMMIT}:${CEILINGS_PATH}`),
  );
  const before: Record<string, Readonly<Record<string, number>>> = { ...introduced, ...first, ...migrated };
  for (const table of [TEAM_COVERAGE_CEILINGS, GOD_CLASS_CUTOVER_CEILINGS, MODULE_SIZE_CUTOVER_CEILINGS]) {
    for (const [rule, buckets] of Object.entries(table)) before[rule] = { ...before[rule], ...buckets };
  }
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
