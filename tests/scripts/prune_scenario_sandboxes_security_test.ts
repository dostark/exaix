/**
 * @module PruneScenarioSandboxesSecurityTest
 * @path tests/scripts/prune_scenario_sandboxes_security_test.ts
 * @description Phase 142 Step 16 — [security] guards for reclaiming the backlog of
 *   sandboxes already on disk. A recursive delete driven by `--root` must never sweep up a
 *   git checkout, a directory lacking a sandbox marker, or be fooled by a nested `.git`.
 * @architectural-layer Test
 * @related-files [scripts/prune_scenario_sandboxes.ts, tests/scripts/helpers/prune_scenario_sandboxes_fixture.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { planSandboxPrune } from "../../scripts/prune_scenario_sandboxes.ts";
import { DAY_MS, seedSandboxRoot } from "./helpers/prune_scenario_sandboxes_fixture.ts";

// `--root` drives a recursive delete. A path one level too high could put a repo checkout
// among the candidates. A sandbox never has a top-level `.git`, but a repository always does.
// That is the discriminator.

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

Deno.test("[security] a directory with no sandbox marker is never selected", async () => {
  // Excluding git checkouts is not enough. Ordinary directories that are not repos would still
  // be selected. Identifying a sandbox by a marker the runner always writes makes a mistyped
  // `--root` inert.
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
