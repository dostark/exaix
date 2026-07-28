#!/usr/bin/env -S deno run -A
/**
 * @module VerifyPackMutations
 * @path scripts/verify_pack_mutations.ts
 *
 * Usage:
 *   deno task verify:pack-mutations                                          # all subsystems
 *   deno run -A scripts/verify_pack_mutations.ts --subsystem=subsystem:skills
 *   deno run -A scripts/verify_pack_mutations.ts --allow-dirty               # skip the clean-tree guard
 *
 * @description Phase 142 Step 21 (GAP-5) — runs each subsystem pack against its declared mutation
 *   and reports whether the pack actually goes red.
 *
 *   Step 7 declared one mutation per subsystem and asserted, as its Success Criterion, that each is
 *   "proven to turn it red". What was built proved something weaker: that each mutation's anchor
 *   still resolves in its file. Anchor resolution survives a pack that asserts nothing at all —
 *   which is the exact state the skills pack was in at mean 0.714, and the identity smokes were in
 *   while passing with the wrong identity. Only one of the six mutations was ever executed.
 *
 *   Reading the result:
 *     - exit 1 from the pack run  → the pack noticed. This is the outcome the criterion claims.
 *     - exit 0 from the pack run  → the pack did NOT notice. That is an insensitivity finding about
 *                                   the pack, to be fixed in the pack rather than by swapping the
 *                                   mutation for one that happens to work.
 *     - exit 2 (infra error)      → red, but weaker evidence: the mutation broke the harness rather
 *                                   than being caught by an assertion. Reported separately.
 *
 *   Manual invocation only (`deno task verify:pack-mutations`). Per standing project instruction,
 *   new tasks are not attached to CI jobs or pre-commit gates — and this one edits source files in
 *   the working tree, so it must be run deliberately.
 * @architectural-layer Script
 * @dependencies [tests/scenario_framework/runner/pack_mutations.ts]
 * @related-files [tests/scenario_framework/tests/unit/pack_mutation_apply_test.ts]
 */

import {
  type IPackMutation,
  mutationsFor,
  runEnvFor,
  SUBSYSTEM_TAGS,
  type SubsystemTag,
  withMutation,
} from "../tests/scenario_framework/runner/pack_mutations.ts";

/** Runner exit code meaning "every scenario passed". */
const EXIT_ALL_PASSED = 0;
/** Runner exit code meaning "at least one scenario failed" — the outcome a mutation must produce. */
const EXIT_SCENARIO_FAILED = 1;
/** Runner exit code meaning the harness itself broke. */
const EXIT_INFRA_ERROR = 2;

/** What a single mutated pack run established. */
interface IMutationVerdict {
  subsystem: SubsystemTag;
  mutation: IPackMutation;
  exitCode: number;
  /** True when the pack failed, i.e. it noticed the mutation. */
  turnedRed: boolean;
  /** True when the failure came from the harness rather than an assertion. */
  infraError: boolean;
  durationMs: number;
}

function runnerArgs(subsystem: SubsystemTag): string[] {
  return [
    "run",
    "-A",
    "tests/scenario_framework/runner/main.ts",
    "--profile",
    "ci-extended",
    "--tag",
    subsystem,
    "--mode",
    "auto",
  ];
}

/** Refuse to start against uncommitted work — a failed revert must be diagnosable. */
async function assertCleanWorkingTree(repoRoot: string): Promise<void> {
  const status = await new Deno.Command("git", {
    args: ["status", "--porcelain"],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const dirty = new TextDecoder().decode(status.stdout).trim();
  if (dirty.length === 0) return;

  throw new Error(
    "refusing to run against a dirty working tree: this script edits source files and restores " +
      "them, and a failed restore must be distinguishable from your own uncommitted work.\n" +
      `Uncommitted:\n${dirty}\n\nCommit or stash first, or pass --allow-dirty if you accept the risk.`,
  );
}

async function verifyMutation(
  repoRoot: string,
  mutation: IPackMutation,
): Promise<IMutationVerdict> {
  const startedAt = performance.now();

  const exitCode = await withMutation(repoRoot, mutation, async () => {
    const run = await new Deno.Command("deno", {
      args: runnerArgs(mutation.subsystem),
      cwd: repoRoot,
      // Which subsystems need a Team build is a property of the pack registry, not of this
      // script — and keeping the edition decision there also keeps edition branching out of
      // `scripts/`, where the style gate rightly forbids it.
      env: runEnvFor(mutation.subsystem),
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    return run.code;
  });

  return {
    subsystem: mutation.subsystem,
    mutation,
    exitCode,
    turnedRed: exitCode !== EXIT_ALL_PASSED,
    infraError: exitCode === EXIT_INFRA_ERROR,
    durationMs: performance.now() - startedAt,
  };
}

function renderTable(verdicts: IMutationVerdict[]): string {
  const rows = verdicts.map((verdict) => {
    const outcome = !verdict.turnedRed ? "❌ STAYED GREEN" : verdict.infraError ? "⚠️ red (infra)" : "✅ red";
    const minutes = (verdict.durationMs / 60_000).toFixed(1);
    return `| \`${verdict.subsystem}\` | ${outcome} | ${verdict.exitCode} | ${minutes} min | ${verdict.mutation.file} |`;
  });

  return [
    "| Subsystem | Outcome | Exit | Wall clock | Mutated file |",
    "| --------- | ------- | ---- | ---------- | ------------ |",
    ...rows,
  ].join("\n");
}

if (import.meta.main) {
  const repoRoot = Deno.cwd();
  const allowDirty = Deno.args.includes("--allow-dirty");
  const only = Deno.args.find((arg) => arg.startsWith("--subsystem="))?.split("=")[1];

  if (!allowDirty) await assertCleanWorkingTree(repoRoot);

  const targets = SUBSYSTEM_TAGS.filter((tag) => only === undefined || tag === only);
  if (targets.length === 0) {
    console.error(`No subsystem matches "${only}". Known: ${SUBSYSTEM_TAGS.join(", ")}`);
    Deno.exit(1);
  }

  const verdicts: IMutationVerdict[] = [];
  for (const subsystem of targets) {
    for (const mutation of mutationsFor(subsystem)) {
      console.log(`\n=== ${subsystem} — mutating ${mutation.file} ===`);
      console.log(`    breaks: ${mutation.breaks}`);
      verdicts.push(await verifyMutation(repoRoot, mutation));
    }
  }

  console.log(`\n${renderTable(verdicts)}\n`);

  const insensitive = verdicts.filter((verdict) => !verdict.turnedRed);
  if (insensitive.length > 0) {
    console.error(
      `❌ ${insensitive.length} pack(s) stayed green under their own mutation. A green run of these ` +
        "packs proves nothing — strengthen the pack's assertions rather than picking a different " +
        `mutation:\n${insensitive.map((v) => `  ${v.subsystem}: ${v.mutation.breaks}`).join("\n")}`,
    );
    Deno.exit(EXIT_SCENARIO_FAILED);
  }

  console.log("✅ Every subsystem pack went red under its declared mutation.");
}
