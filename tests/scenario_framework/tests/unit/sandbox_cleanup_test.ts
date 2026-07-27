/**
 * @module ScenarioFrameworkSandboxCleanupTest
 * @path tests/scenario_framework/tests/unit/sandbox_cleanup_test.ts
 * @description Phase 142 Step 16 — a run reclaims the sandbox it minted, and never one it did not.
 *
 *   `resolveRuntimeConfigForExecution` mints `<base>/exaix-sandboxes/<runId>` per invocation and
 *   nothing anywhere removes it, so growth is unbounded and proportional to how often anyone runs
 *   scenarios. Re-measured for this step: 103 sandboxes, 407 MB — ~4 MB each, up from ~1 MB when
 *   the step was written, because Step 13 began seeding `Blueprints/`, `Memory/` and the git-backed
 *   portal fixtures into every sandbox. `fixtures/` alone is 2.5 MB of a 4.1 MB sandbox.
 *
 *   Two asymmetries the tests pin down, because both fail silently in the wrong direction:
 *
 *   - **Failure retains.** The cost of keeping a failed run's state is disk; the cost of discarding
 *     it is an undiagnosable failure. A run that fails must keep its journal and daemon log and say
 *     where they are.
 *   - **Provenance is tracked, not inferred.** A `--workspace` the operator supplied is their
 *     directory. Deciding by path shape (does it look like a sandbox?) would delete a real
 *     workspace the day someone points `--workspace` at something under the sandbox base.
 *
 *   Evidence is preserved by exclusion rather than relocation: the default `output_dir` lives
 *   inside the sandbox (`config.ts:153`), and eval-history entries reference those paths, so moving
 *   them would leave dangling references. Excluding `output/` keeps them valid and still reclaims
 *   substantially all of the bytes.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/sandbox_lifecycle.ts, tests/scenario_framework/runner/config.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  applySandboxCleanup,
  planSandboxCleanup,
  SandboxRetention,
  WorkspaceProvenance,
} from "../../runner/sandbox_lifecycle.ts";

function plan(overrides: {
  provenance?: WorkspaceProvenance;
  keepSandbox?: boolean;
  runPassed?: boolean;
  workspacePath?: string;
  outputDir?: string;
}) {
  const workspacePath = overrides.workspacePath ?? "/base/exaix-sandboxes/run-1";
  return planSandboxCleanup({
    workspacePath,
    outputDir: overrides.outputDir ?? join(workspacePath, "output"),
    provenance: overrides.provenance ?? WorkspaceProvenance.RUNNER_MINTED,
    keepSandbox: overrides.keepSandbox ?? false,
    runPassed: overrides.runPassed ?? true,
  });
}

// ── The decision ────────────────────────────────────────────────────────────────────────────

Deno.test("[sandbox-cleanup] a successful run removes a runner-minted sandbox", () => {
  assertEquals(plan({}).retention, SandboxRetention.REMOVED);
});

Deno.test("[sandbox-cleanup] a failing run retains the sandbox", () => {
  // The important asymmetry: a failure is exactly when the journal and daemon log are needed.
  assertEquals(plan({ runPassed: false }).retention, SandboxRetention.KEPT_RUN_FAILED);
});

Deno.test("[sandbox-cleanup] --keep-sandbox retains on success", () => {
  assertEquals(plan({ keepSandbox: true }).retention, SandboxRetention.KEPT_BY_FLAG);
});

Deno.test("[sandbox-cleanup] an operator-supplied workspace is never removed", () => {
  for (const runPassed of [true, false]) {
    for (const keepSandbox of [true, false]) {
      const decision = plan({ provenance: WorkspaceProvenance.OPERATOR_SUPPLIED, runPassed, keepSandbox });
      assertEquals(
        decision.retention,
        SandboxRetention.KEPT_OPERATOR_WORKSPACE,
        `operator workspace must survive (runPassed=${runPassed}, keepSandbox=${keepSandbox})`,
      );
    }
  }
});

Deno.test("[sandbox-cleanup] provenance wins over the keep flag, so the reason reported is the real one", () => {
  // Not cosmetic: the printed reason is what tells an operator why their directory is still there.
  assertEquals(
    plan({ provenance: WorkspaceProvenance.OPERATOR_SUPPLIED, keepSandbox: true }).retention,
    SandboxRetention.KEPT_OPERATOR_WORKSPACE,
  );
});

Deno.test("[sandbox-cleanup] an in-sandbox output dir is preserved; an external one is not listed", () => {
  assertEquals(plan({}).preserve, ["output"]);
  // With `--output` pointing outside the sandbox there is nothing inside worth keeping.
  assertEquals(plan({ outputDir: "/elsewhere/evidence" }).preserve, []);
});

// ── Applying it ─────────────────────────────────────────────────────────────────────────────

async function makeSandbox(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "sandbox-cleanup-" });
  await Deno.mkdir(join(root, ".exa"), { recursive: true });
  await Deno.writeTextFile(join(root, ".exa", "journal.db"), "journal bytes");
  await Deno.mkdir(join(root, "Blueprints", "Flows"), { recursive: true });
  await Deno.writeTextFile(join(root, "Blueprints", "Flows", "a.flow.yaml"), "id: a");
  await Deno.mkdir(join(root, "fixtures", "portals"), { recursive: true });
  await Deno.writeTextFile(join(root, "fixtures", "portals", "big"), "x".repeat(1024));
  await Deno.writeTextFile(join(root, "exa.config.toml"), '[system]\nroot = "."\n');
  await Deno.mkdir(join(root, "output"), { recursive: true });
  await Deno.writeTextFile(join(root, "output", "run-manifest.json"), JSON.stringify({ scenarios: ["a"] }));
  return root;
}

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false);
}

Deno.test("[sandbox-cleanup] removal keeps the evidence dir and the manifest stays readable", async () => {
  const root = await makeSandbox();
  try {
    const decision = planSandboxCleanup({
      workspacePath: root,
      outputDir: join(root, "output"),
      provenance: WorkspaceProvenance.RUNNER_MINTED,
      keepSandbox: false,
      runPassed: true,
    });

    const outcome = await applySandboxCleanup(decision, root);

    assertEquals(outcome.removed, true);
    assertEquals(await exists(join(root, ".exa")), false, "runtime state must go");
    assertEquals(await exists(join(root, "Blueprints")), false);
    assertEquals(await exists(join(root, "fixtures")), false, "the 2.5MB of portal fixtures must go");
    assertEquals(await exists(join(root, "exa.config.toml")), false);

    const manifest = JSON.parse(await Deno.readTextFile(join(root, "output", "run-manifest.json")));
    assertEquals(manifest.scenarios, ["a"], "the manifest an eval-history entry points at must still parse");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[sandbox-cleanup] with no in-sandbox evidence the whole directory goes", async () => {
  const root = await makeSandbox();
  await Deno.remove(join(root, "output"), { recursive: true });
  try {
    const decision = planSandboxCleanup({
      workspacePath: root,
      outputDir: "/elsewhere/evidence",
      provenance: WorkspaceProvenance.RUNNER_MINTED,
      keepSandbox: false,
      runPassed: true,
    });

    const outcome = await applySandboxCleanup(decision, root);

    assertEquals(outcome.removed, true);
    assertEquals(await exists(root), false, "nothing to preserve means the sandbox path itself goes");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[sandbox-cleanup] a retained sandbox is left exactly as it was", async () => {
  const root = await makeSandbox();
  try {
    const decision = planSandboxCleanup({
      workspacePath: root,
      outputDir: join(root, "output"),
      provenance: WorkspaceProvenance.RUNNER_MINTED,
      keepSandbox: false,
      runPassed: false,
    });

    const outcome = await applySandboxCleanup(decision, root);

    assertEquals(outcome.removed, false);
    assert(await exists(join(root, ".exa", "journal.db")), "a failed run's journal is the point");
    assert(await exists(join(root, "Blueprints", "Flows", "a.flow.yaml")));
    assertEquals(outcome.path, root, "the retained path must be reported so an operator can find it");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[sandbox-cleanup] cleanup refuses a path that is not the sandbox it was planned for", async () => {
  // A guard on the most destructive call in the framework: the plan and the target must agree,
  // so a refactor that threads the wrong root deletes nothing instead of the wrong thing.
  const root = await makeSandbox();
  try {
    const decision = planSandboxCleanup({
      workspacePath: "/base/exaix-sandboxes/some-other-run",
      outputDir: "/base/exaix-sandboxes/some-other-run/output",
      provenance: WorkspaceProvenance.RUNNER_MINTED,
      keepSandbox: false,
      runPassed: true,
    });

    let threw = false;
    try {
      await applySandboxCleanup(decision, root);
    } catch {
      threw = true;
    }

    assertEquals(threw, true, "a mismatched target must throw rather than remove");
    assert(await exists(join(root, ".exa")), "nothing may be removed on refusal");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
