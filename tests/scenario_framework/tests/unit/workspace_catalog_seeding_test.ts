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
import { seedWorkspaceCatalogs } from "../../runner/synthetic_runner.ts";

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
    assert(await exists(join(ws, "Blueprints", "Identities", "senior-coder.md")), "identities must be seeded");
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
    const identities = join(ws, "Blueprints", "Identities");
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
