/**
 * @module TeamRegistrySeamTest
 * @path tests/integration/team_registry_seam_test.ts
 * @description Phase 135 Step 1 (GAP-2/GAP-3) — the Team model-registry provider
 *   registration: registering before selection yields the live ModelRegistryService
 *   (not the Solo floor) from the composer hook, and the provider closes over
 *   db/config/floor while taking healthChecker from the seam deps.
 * @architectural-layer Integration
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { TeamComposer } from "@exaix-team/team-composer";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { ModelRegistryService } from "@exaix-team/model-registry-live";
import { registerTeamModelRegistry } from "../../apps/daemon/src/bootstrap_team.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

Deno.test("[gap2] registerTeamModelRegistry: composer selects the live service, not the floor", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const composer = new TeamComposer();
    // Registration closes over db/config/logger/floor (GAP-3); healthChecker arrives via deps.
    registerTeamModelRegistry(composer, {
      db,
      config,
      logger: createMockEventLogger(),
    });

    const provider = composer.getModelRegistryProvider();
    assertEquals(provider !== undefined, true);

    const selected = provider!.createModelRegistry({
      providerRegistry: {},
      healthChecker: HEALTHY,
    });
    // The selected registry is the Team live service, NOT the Solo floor (GAP-2 ordering).
    assertEquals(selected instanceof ModelRegistryService, true);
    assertEquals(selected instanceof DefaultModelRegistry, false);
  } finally {
    await cleanup();
  }
});

Deno.test("[gap2] Solo composer has no registry provider (unregistered = floor path)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    const composer = new TeamComposer();
    // Without registration, the composer yields undefined → daemon falls to the floor.
    assertEquals(composer.getModelRegistryProvider(), undefined);
  } finally {
    await cleanup();
  }
});
