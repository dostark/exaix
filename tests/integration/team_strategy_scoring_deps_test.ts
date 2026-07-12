/**
 * @module TeamStrategyScoringDepsTest
 * @path tests/integration/team_strategy_scoring_deps_test.ts
 * @description Phase 135 Step 8 — buildTeamResolutionStrategy threads
 *   config.model_registry.benchmark_map and usage_tiebreak into the
 *   TeamResolutionStrategy deps so scoreBest/rankUsage observe the real config
 *   (not just the Step 6 route-policy fields).
 * @architectural-layer Integration
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { ModelRegistryService } from "@exaix-team/model-registry-live";
import { TaskType } from "@exaix/core/types";
import { buildTeamResolutionStrategy } from "../../apps/daemon/src/bootstrap_team.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

Deno.test("[step135.8] buildTeamResolutionStrategy threads config.model_registry.benchmark_map into scoreBest", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY);
    await svc.applyBenchmarks([
      { provider: "anthropic", model: "m", benchmark: "gpqa", score: 0.8, provenance: "static", measuredAt: 1 },
    ]);
    config.model_registry = {
      ...config.model_registry,
      benchmark_map: { [TaskType.ANALYSIS]: ["gpqa"] },
    } as typeof config.model_registry;

    const strategy = buildTeamResolutionStrategy(svc, config, createMockEventLogger());
    const scores = await strategy!.scoreBest!([{ provider: "anthropic", model: "m" }], TaskType.ANALYSIS);

    assertEquals(scores["anthropic"], 0.8);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][F8] buildTeamResolutionStrategy threads config.model_registry.usage_tiebreak into rankUsage", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY);
    config.model_registry = { ...config.model_registry, usage_tiebreak: false } as typeof config.model_registry;

    const strategy = buildTeamResolutionStrategy(svc, config, createMockEventLogger());
    const ranked = await strategy!.rankUsage!([{ provider: "anthropic", model: "m" }]);

    assertEquals(ranked, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][F8] usage_tiebreak=true opt-in observably ranks (real config flip)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY);
    db.instance.prepare(
      `INSERT INTO provider_costs (id, provider, model, requests, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run("1", "anthropic", "m", 5, "2026-01-01T00:00:00.000Z");
    config.model_registry = { ...config.model_registry, usage_tiebreak: true } as typeof config.model_registry;

    const strategy = buildTeamResolutionStrategy(svc, config, createMockEventLogger());
    const ranked = await strategy!.rankUsage!([{ provider: "anthropic", model: "m" }]);

    assertEquals(ranked, ["anthropic"]);
  } finally {
    await cleanup();
  }
});
