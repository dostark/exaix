/**
 * @module ScenarioFrameworkWorkspaceCatalogSeedingTest
 * @path tests/scenario_framework/tests/unit/workspace_catalog_seeding_test.ts
 * @description Phase 142 Step 13 — the sandbox must carry the catalogs the daemon resolves
 *   against its workspace root: `Blueprints/` and `Memory/Skills`.
 *
 *   A fresh sandbox had neither. `assertFlowExists` resolves
 *   `<root>/Blueprints/Flows/<id>.flow.yaml`, so every flow request was rejected with
 *   "Flow '<id>' not found" — 15 of the flow_blueprints scenarios at once. Step 17 hit the
 *   same gap for skills (`SkillsService` loaded zero skills, `total_available: 0`) and worked
 *   around it with a per-scenario `sh -c` copy step. Seeding once in the runner replaces that
 *   workaround rather than repeating it per pack, which is what the
 *   `skill-catalog-sandbox-seeding` ledger row asked for.
 *
 *   Seeding is additive: it fills in what is absent and never overwrites, so a scenario that
 *   deliberately patches an identity in its sandbox keeps the patch, and an operator-supplied
 *   workspace is not rewritten under them.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, apps/exactl/src/handlers/request_create_handler.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  capturePortalBaselines,
  detectPortalDrift,
  seedPortalFixtures,
  seedWorkspaceCatalogs,
} from "../../runner/synthetic_runner.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("[workspace_catalog_seeding] a fresh sandbox receives the flow catalog", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-flows-" });
  try {
    await seedWorkspaceCatalogs(ws, REPO_ROOT);
    assert(await exists(join(ws, "Blueprints", "Flows", "api-design.flow.yaml")), "flow blueprints must be seeded");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[workspace_catalog_seeding] a fresh sandbox receives the identity and skill catalogs", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-rest-" });
  try {
    await seedWorkspaceCatalogs(ws, REPO_ROOT);
    assert(await exists(join(ws, "Blueprints", "Agents", "senior-coder.md")), "identities must be seeded");
    assert(await exists(join(ws, "Memory", "Skills")), "the skill catalog must be seeded");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[workspace_catalog_seeding] seeding never overwrites a catalog already in the sandbox", async () => {
  // A scenario that patches an identity in its own sandbox — the capability-patch step in
  // scenario_templates.ts does exactly this — must not have the patch reverted by a later
  // scenario's seeding pass over the shared workspace.
  const ws = await Deno.makeTempDir({ prefix: "seed-nooverwrite-" });
  try {
    const identities = join(ws, "Blueprints", "Agents");
    await Deno.mkdir(identities, { recursive: true });
    await Deno.writeTextFile(join(identities, "senior-coder.md"), "PATCHED BY SCENARIO");

    await seedWorkspaceCatalogs(ws, REPO_ROOT);

    assertEquals(await Deno.readTextFile(join(identities, "senior-coder.md")), "PATCHED BY SCENARIO");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[workspace_catalog_seeding] seeding is idempotent", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-idempotent-" });
  try {
    await seedWorkspaceCatalogs(ws, REPO_ROOT);
    await seedWorkspaceCatalogs(ws, REPO_ROOT);
    // A second pass must not nest the catalog inside itself, which is exactly what the
    // per-scenario `cp -r <src>/Skills <dst>/Skills` workaround does when the target exists.
    assertEquals(await exists(join(ws, "Memory", "Skills", "Skills")), false);
    assertEquals(await exists(join(ws, "Blueprints", "Blueprints")), false);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

// Portal fixtures must be git repos: all portal mutation goes through a git worktree, and a
// non-repo portal can't have one — an agent given one either bypasses isolation or silently
// writes into the portal root.

async function gitIn(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const result = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  return { ok: result.success, out: new TextDecoder().decode(result.stdout).trim() };
}

Deno.test("[portal_fixtures] every seeded portal is a git repo with a base commit", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-portals-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);

    const portalsRoot = join(ws, "fixtures", "portals");
    let checked = 0;
    for await (const entry of Deno.readDir(portalsRoot)) {
      if (!entry.isDirectory) continue;
      const portal = join(portalsRoot, entry.name);
      assert(await exists(join(portal, ".git")), `${entry.name} must be a git repo`);
      const head = await gitIn(portal, ["rev-parse", "HEAD"]);
      assert(head.ok && head.out.length > 0, `${entry.name} must have a base commit for worktrees to branch from`);
      checked++;
    }
    assert(checked > 0, "expected at least one portal fixture to be seeded");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[portal_fixtures] a seeded portal supports creating a worktree", async () => {
  // The whole point: if `git worktree add` fails, portal mutation has nowhere isolated to go.
  const ws = await Deno.makeTempDir({ prefix: "seed-portals-wt-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);
    const portal = join(ws, "fixtures", "portals", "simple_repo");
    const wt = join(ws, "wt");

    const added = await gitIn(portal, ["worktree", "add", "-b", "exaix/test", wt]);

    assert(added.ok, "a seeded portal must support git worktree add");
    assert(await exists(wt), "the worktree checkout must exist");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[portal_fixtures] seeding a portal twice does not reinitialise it", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-portals-idem-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);
    const portal = join(ws, "fixtures", "portals", "simple_repo");
    const first = await gitIn(portal, ["rev-parse", "HEAD"]);

    await seedPortalFixtures(ws, REPO_ROOT);
    const second = await gitIn(portal, ["rev-parse", "HEAD"]);

    assertEquals(second.out, first.out, "a second pass must not discard the portal's history");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

// `getExecutionStrategy` forces WORKTREE for every portal task, but nothing checked the
// OUTCOME — a write that misses the worktree lands silently on the default branch and looks
// like success.

Deno.test("[portal_drift] a portal mutated through a worktree branch is not flagged", async () => {
  const ws = await Deno.makeTempDir({ prefix: "drift-ok-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);
    const baselines = await capturePortalBaselines(ws);
    const portal = join(ws, "fixtures", "portals", "simple_repo");
    const wt = join(ws, "wt");
    await gitIn(portal, ["worktree", "add", "-b", "exaix/task-1", wt]);

    // The agent's work happens in the worktree, on its own branch — the sanctioned path.
    await Deno.writeTextFile(join(wt, "NEW.md"), "agent output\n");
    await gitIn(wt, ["-c", "user.email=a@b.c", "-c", "user.name=A", "add", "-A"]);
    await gitIn(wt, ["-c", "user.email=a@b.c", "-c", "user.name=A", "commit", "-m", "feat: work"]);

    assertEquals(await detectPortalDrift(ws, baselines), [], "worktree-branch work must not count as drift");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[portal_drift] a commit landing on the portal's default branch is caught", async () => {
  const ws = await Deno.makeTempDir({ prefix: "drift-branch-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);
    const baselines = await capturePortalBaselines(ws);
    const portal = join(ws, "fixtures", "portals", "simple_repo");

    await Deno.writeTextFile(join(portal, "LEAKED.md"), "written outside a worktree\n");
    await gitIn(portal, ["-c", "user.email=a@b.c", "-c", "user.name=A", "add", "-A"]);
    await gitIn(portal, ["-c", "user.email=a@b.c", "-c", "user.name=A", "commit", "-m", "leak"]);

    const drift = await detectPortalDrift(ws, baselines);
    assertEquals(drift.length, 1, `expected drift to be reported, got: ${drift.join("; ")}`);
    assert(drift[0].includes("default branch moved"), drift[0]);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[portal_drift] an uncommitted write into the portal root is caught", async () => {
  // The likelier real failure: a tool writes straight into the portal without committing.
  const ws = await Deno.makeTempDir({ prefix: "drift-dirty-" });
  try {
    await seedPortalFixtures(ws, REPO_ROOT);
    const baselines = await capturePortalBaselines(ws);

    await Deno.writeTextFile(join(ws, "fixtures", "portals", "simple_repo", "STRAY.md"), "oops\n");

    const drift = await detectPortalDrift(ws, baselines);
    assertEquals(drift.length, 1, `expected drift to be reported, got: ${drift.join("; ")}`);
    assert(drift[0].includes("working tree dirty"), drift[0]);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

// Seeding must be additive at the FILE level, not the directory level: seeding used to skip
// whenever `Blueprints/` merely existed, so a scenario that creates the directory via its own
// `cp -r`/`mkdir` left every later scenario in the shared sandbox with a partial catalog.

Deno.test("[workspace_catalog_seeding] a partially-created catalog is completed, not skipped", async () => {
  const ws = await Deno.makeTempDir({ prefix: "seed-partial-" });
  try {
    // What a scenario's own `cp -r`/`mkdir` leaves behind: the directory exists, the files do not.
    await Deno.mkdir(join(ws, "Blueprints", "Agents"), { recursive: true });
    await Deno.mkdir(join(ws, "Blueprints", "Flows"), { recursive: true });

    await seedWorkspaceCatalogs(ws, REPO_ROOT);

    assert(
      await exists(join(ws, "Blueprints", "Flows", "analyze-codebase.flow.yaml")),
      "the shipped flow catalog must be seeded even though Blueprints/ already existed",
    );
    assert(await exists(join(ws, "Blueprints", "Agents", "senior-coder.md")), "identities too");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[workspace_catalog_seeding] completing a partial catalog still never overwrites", async () => {
  // The no-overwrite guarantee must survive the fix: a scenario that patches an identity in
  // the shared sandbox keeps its patch.
  const ws = await Deno.makeTempDir({ prefix: "seed-partial-nooverwrite-" });
  try {
    const identities = join(ws, "Blueprints", "Agents");
    await Deno.mkdir(identities, { recursive: true });
    await Deno.writeTextFile(join(identities, "senior-coder.md"), "PATCHED BY SCENARIO");

    await seedWorkspaceCatalogs(ws, REPO_ROOT);

    assertEquals(await Deno.readTextFile(join(identities, "senior-coder.md")), "PATCHED BY SCENARIO");
    assert(await exists(join(identities, "code-analyst.md")), "the rest of the catalog still arrives");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[workspace_catalog_seeding] a flow staged by an earlier scenario does not starve the catalog", async () => {
  // The exact shape `stageFlowFixture` leaves: Blueprints/Flows exists holding one staged fixture.
  const ws = await Deno.makeTempDir({ prefix: "seed-staged-" });
  try {
    const flows = join(ws, "Blueprints", "Flows");
    await Deno.mkdir(flows, { recursive: true });
    await Deno.writeTextFile(join(flows, "explore-codebase.flow.yaml"), 'id: "explore-codebase"');

    await seedWorkspaceCatalogs(ws, REPO_ROOT);

    assert(await exists(join(flows, "analyze-codebase.flow.yaml")), "shipped flows must still arrive");
    assertEquals(
      await Deno.readTextFile(join(flows, "explore-codebase.flow.yaml")),
      'id: "explore-codebase"',
      "the staged fixture must survive",
    );
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});
