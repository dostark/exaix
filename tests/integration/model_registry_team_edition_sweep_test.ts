/**
 * @module ModelRegistryTeamEditionSweepTest
 * @path tests/integration/model_registry_team_edition_sweep_test.ts
 * @description Phase 135 Step 9 (Action 3) — the edition sweep, on real daemon
 *   subprocesses:
 *   (1) `EXAIX_EDITION=team` with `model_registry.enabled=false` makes ZERO outbound
 *       requests to the five catalog adapters — proven by observing the stub servers'
 *       own request counters after a real daemon lifecycle (maybeCreateRefreshScheduler
 *       returns undefined when disabled, so no scheduler is ever constructed, let alone
 *       started — apps/daemon/main.ts never calls .start()).
 *   (2) one provider's adapter failing mid-cycle (HTTP 500) does not prevent the other
 *       four providers from refreshing successfully — model.registry.refresh.failed
 *       fires for the failing provider while model.catalog.refreshed fires for the rest
 *       (registry_refresh_scheduler.ts's per-provider isolation, §7.2).
 * @architectural-layer Test
 * @related-files [apps/daemon/src/bootstrap_team.ts, packages-team/model-registry-live/src/registry_refresh_scheduler.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";
import { type IStubCatalogServer, shutdownAll, startAllStubCatalogServers } from "./helpers/stub_catalog_servers.ts";

function writeTeamConfig(
  configPath: string,
  root: string,
  adapterBaseUrls: Record<string, string>,
  registryEnabled: boolean,
): void {
  const overrideLines = Object.entries(adapterBaseUrls).map(([provider, url]) => `${provider} = "${url}"`);
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[model_registry]",
    `enabled = ${registryEnabled}`,
    "refresh_on_start = true",
    "",
    "[model_registry.adapter_base_urls]",
    ...overrideLines,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

interface IJournalEvent {
  action_type: string;
  payload: string | null;
}

async function readEvents(configPath: string, actionType: string): Promise<IJournalEvent[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IJournalEvent>(
      "SELECT action_type, payload FROM activity WHERE action_type = ? ORDER BY rowid",
      [actionType],
    );
  } catch {
    return [];
  } finally {
    await db.close();
  }
}

Deno.test({
  name: "[step135.9] real Team daemon: model_registry.enabled=false makes ZERO requests to the catalog adapters",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-edition-sweep-disabled-" });
    const configPath = join(tempDir, "exa.config.toml");
    let stubs: IStubCatalogServer[] = [];
    try {
      const started = startAllStubCatalogServers();
      stubs = started.servers;

      await runMigrationsIn(tempDir);
      writeTeamConfig(configPath, tempDir, started.adapterBaseUrls, false);

      await bootRealDaemon(configPath, 3000, { extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" } });

      for (const stub of stubs) {
        assertEquals(
          stub.requestCount(),
          0,
          `${stub.provider} stub must receive zero requests when model_registry.enabled=false ` +
            "(maybeCreateRefreshScheduler returns undefined; no scheduler is ever started)",
        );
      }
    } finally {
      await shutdownAll(stubs);
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[step135.9] real Team daemon: one adapter failing mid-cycle does not prevent the other four from refreshing (§7.2 isolation)",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-edition-sweep-failure-" });
    const configPath = join(tempDir, "exa.config.toml");
    let stubs: IStubCatalogServer[] = [];
    try {
      const started = startAllStubCatalogServers("anthropic");
      stubs = started.servers;

      await runMigrationsIn(tempDir);
      writeTeamConfig(configPath, tempDir, started.adapterBaseUrls, true);

      await bootRealDaemon(configPath, 4000, { extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" } });

      const failedEvents = await readEvents(configPath, "model.registry.refresh.failed");
      const anthropicFailure = failedEvents.find((e) => (e.payload ?? "").includes('"provider":"anthropic"'));
      assert(anthropicFailure, "anthropic's forced HTTP 500 must be recorded as a refresh failure");

      const refreshedEvents = await readEvents(configPath, "model.catalog.refreshed");
      const refreshedProviders = new Set(
        refreshedEvents
          .map((e) => (JSON.parse(e.payload ?? "{}") as { provider?: string }).provider)
          .filter((p): p is string => Boolean(p)),
      );
      for (const provider of ["openai", "google", "ollama", "openrouter"]) {
        assert(
          refreshedProviders.has(provider),
          `${provider} must still refresh successfully despite anthropic's failure (no cross-provider rollback)`,
        );
      }
    } finally {
      await shutdownAll(stubs);
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
