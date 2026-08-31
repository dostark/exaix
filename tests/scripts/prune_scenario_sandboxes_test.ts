/**
 * @module PruneScenarioSandboxesTest
 * @path tests/scripts/prune_scenario_sandboxes_test.ts
 * @description Phase 142 Step 16 — reclaiming the backlog of sandboxes already on disk.
 *
 *   Cleanup-on-success only helps runs from now on. 103 sandboxes totalling 407 MB predate it on
 *   one development machine, and a CI runner accumulates them until the disk fills — presenting as
 *   an unrelated build failure. This is the documented command for that, dry-run by default
 *   because the alternative is a hand-crafted `rm -rf` over a glob, which is how someone eventually
 *   deletes the wrong directory.
 *
 *   The selection is by modification time rather than by parsing the run-id: the id's timestamp
 *   prefix is base-36 and could drift, whereas mtime is what actually says "nothing has touched
 *   this in a week".
 * @architectural-layer Test
 * @related-files [scripts/prune_scenario_sandboxes.ts, tests/scenario_framework/runner/sandbox_lifecycle.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { applySandboxPrune, planSandboxPrune } from "../../scripts/prune_scenario_sandboxes.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ISeededSandbox {
  name: string;
  ageDays: number;
}

async function seedSandboxRoot(entries: ISeededSandbox[]): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "prune-sandboxes-" });
  const now = Date.now();
  for (const entry of entries) {
    const dir = join(root, entry.name);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "exa.config.toml"), "[system]\n");
    const stamp = new Date(now - entry.ageDays * DAY_MS);
    await Deno.utime(dir, stamp, stamp);
  }
  return root;
}

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false);
}

Deno.test("[prune] a retention window selects only sandboxes older than it", async () => {
  const root = await seedSandboxRoot([
    { name: "old-a", ageDays: 30 },
    { name: "old-b", ageDays: 8 },
    { name: "fresh", ageDays: 1 },
    { name: "today", ageDays: 0 },
  ]);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.map((entry) => entry.name).sort(), ["old-a", "old-b"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] a dry run lists without deleting", async () => {
  const root = await seedSandboxRoot([{ name: "old-a", ageDays: 30 }]);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.length, 1);
    assert(await exists(join(root, "old-a")), "planning must never remove anything");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] the plan reports reclaimable bytes so the operator can judge before deleting", async () => {
  const root = await seedSandboxRoot([{ name: "old-a", ageDays: 30 }]);
  await Deno.writeTextFile(join(root, "old-a", "payload"), "x".repeat(4096));
  // Writing into the directory bumps its mtime to now, which would put it back inside the
  // retention window — re-stamp so the age under test is the one the helper set.
  const aged = new Date(Date.now() - 30 * DAY_MS);
  await Deno.utime(join(root, "old-a"), aged, aged);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assert(plan.totalBytes >= 4096, `expected the payload to be counted, got ${plan.totalBytes}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] a missing root is an empty plan, not a crash", async () => {
  // A machine that has never run a scenario has no sandbox root; the periodic CI invocation must
  // not fail there.
  const plan = await planSandboxPrune({ root: "/nonexistent/exaix-sandboxes", retentionDays: 7 });
  assertEquals(plan.selected, []);
  assertEquals(plan.totalBytes, 0);
});

Deno.test("[prune] files sitting beside the sandboxes are never selected", async () => {
  // Only directories are sandboxes. A stray file in the root must not be swept up.
  const root = await seedSandboxRoot([{ name: "old-a", ageDays: 30 }]);
  const strayStamp = new Date(Date.now() - 30 * DAY_MS);
  await Deno.writeTextFile(join(root, "README"), "not a sandbox");
  await Deno.utime(join(root, "README"), strayStamp, strayStamp);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 7 });
    assertEquals(plan.selected.map((entry) => entry.name), ["old-a"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] retentionDays of 0 selects everything, and is still only a plan", async () => {
  const root = await seedSandboxRoot([{ name: "today", ageDays: 0 }, { name: "old", ageDays: 30 }]);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 0 });
    assertEquals(plan.selected.length, 2);
    assert(await exists(join(root, "today")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// `--root` is operator input that drives a recursive delete. Pointing it one level too high —
// at the parent of the repo, which is the DEFAULT sandbox base's parent — would put the repo
// checkout itself among the candidates, and a stale mtime is all it would take. A sandbox never
// has a top-level `.git`; a repository always does, so that is the discriminator.

Deno.test("[security] a git repository is never selected for pruning", async () => {
  const root = await seedSandboxRoot([{ name: "a-sandbox", ageDays: 30 }, { name: "a-checkout", ageDays: 30 }]);
  try {
    await Deno.mkdir(join(root, "a-checkout", ".git"), { recursive: true });
    const aged = new Date(Date.now() - 30 * DAY_MS);
    await Deno.utime(join(root, "a-checkout"), aged, aged);

    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.map((entry) => entry.name), ["a-sandbox"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] a nested .git inside a sandbox does not protect it", async () => {
  // The seeded portal fixtures ARE git repos, at `<sandbox>/fixtures/portals/<name>/.git`. Only a
  // top-level `.git` means "this directory is a checkout"; anything deeper is a sandbox's contents.
  const root = await seedSandboxRoot([{ name: "sandbox-with-fixtures", ageDays: 30 }]);
  try {
    await Deno.mkdir(join(root, "sandbox-with-fixtures", "fixtures", "portals", "repo", ".git"), { recursive: true });
    const aged = new Date(Date.now() - 30 * DAY_MS);
    await Deno.utime(join(root, "sandbox-with-fixtures"), aged, aged);

    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.map((entry) => entry.name), ["sandbox-with-fixtures"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] applying a plan removes exactly what it selected", async () => {
  const root = await seedSandboxRoot([{ name: "old", ageDays: 30 }, { name: "fresh", ageDays: 1 }]);
  try {
    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    const removed = await applySandboxPrune(plan);

    assertEquals(removed, 1);
    assertEquals(await exists(join(root, "old")), false);
    assert(await exists(join(root, "fresh")), "a sandbox inside the window must survive --apply");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] a directory with no sandbox marker is never selected", async () => {
  // Excluding git checkouts is not enough. Pointed at `/home/user/git`, the plan still selected
  // four ordinary directories that merely happened not to be repos. Identifying a sandbox
  // POSITIVELY — by a marker the runner always writes — is what makes a mistyped `--root` inert
  // instead of merely less bad.
  const root = await seedSandboxRoot([{ name: "real-sandbox", ageDays: 30 }]);
  try {
    const aged = new Date(Date.now() - 30 * DAY_MS);
    for (const name of ["my-photos", "notes"]) {
      await Deno.mkdir(join(root, name), { recursive: true });
      await Deno.writeTextFile(join(root, name, "something.txt"), "personal");
      await Deno.utime(join(root, name), aged, aged);
    }

    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.map((entry) => entry.name), ["real-sandbox"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[prune] an already-reclaimed sandbox is still prunable", async () => {
  // After cleanup a sandbox holds only `output/` — it has no `exa.config.toml` any more. Those
  // remnants are exactly what a backlog sweep should eventually collect, so the marker check has
  // to recognise them too.
  const root = await Deno.makeTempDir({ prefix: "prune-reclaimed-" });
  try {
    const reclaimed = join(root, "reclaimed-run");
    await Deno.mkdir(join(reclaimed, "output"), { recursive: true });
    await Deno.writeTextFile(join(reclaimed, "output", "run-manifest.json"), "{}");
    const aged = new Date(Date.now() - 30 * DAY_MS);
    await Deno.utime(reclaimed, aged, aged);

    const plan = await planSandboxPrune({ root, retentionDays: 7 });

    assertEquals(plan.selected.map((entry) => entry.name), ["reclaimed-run"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
