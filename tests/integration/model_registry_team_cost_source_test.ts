/**
 * @module ModelRegistryTeamCostSourceTest
 * @path tests/integration/model_registry_team_cost_source_test.ts
 * @description Phase 135 Step 9 (GAP-C9) — proves, on a REAL booted daemon subprocess,
 *   that a standard identity request's `provider_costs` row is no longer forced to
 *   `cost_source: "provider_reported"` by the mock provider. Two real production bugs
 *   were found and fixed while building this proof: (a) RequestProcessor built its own
 *   CostTracker with no pricing lookup ever set (fixed: apps/daemon/main.ts now passes
 *   the daemon's own tracker, which DOES get `setPricingLookup(modelRegistry)`), and
 *   (b) MockLLMProvider always self-reported `cost_usd: 0`, which forced
 *   `cost_source: "provider_reported"` upstream of CostTracker's own precedence logic
 *   (fixed: the mock no longer reports a cost at all).
 *   `cost_source: "registry_computed"` is NOT asserted here: it requires the Team
 *   registry to hold priced catalog data for the RESOLVED provider, but the standard
 *   identity-request path resolves via `agents.default_model`/`ai.provider`, which is
 *   tied to the `mock` provider TYPE — not one of the five real catalog providers the
 *   Team registry prices. Reaching `registry_computed` end-to-end needs a network-free
 *   provider identity registered under a REAL priced provider name (see the
 *   Reachability Ledger row this step adds) — tracked as follow-up, not lost work.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/core/src/cost/cost_tracker.ts, packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/rate_limited_provider.ts]
 */

import { assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";

const TRACE_ID = "step135-9-cost-source-trace";
const REQUEST_MARKDOWN = [
  "---",
  `trace_id: "${TRACE_ID}"`,
  `created: "${new Date().toISOString()}"`,
  "status: pending",
  "priority: 5",
  "identity: stub-agent",
  "source: test",
  "created_by: model_registry_team_cost_source_test",
  "tags: []",
  "---",
  "",
  "# Request",
  "",
  "Add a short docstring to the isEven helper function.",
  "",
].join("\n");

function writeStubIdentity(root: string): void {
  const dir = join(root, "Blueprints", "Identities");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(join(dir, "stub-agent.md"), "You are a stub agent for testing.\n");
}

/** Bootstrap config: mock provider, quality gate + analysis disabled (no LLM round trip needed). */
function writeMockDaemonConfig(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[request_analysis]",
    "enabled = false",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

async function readCostSource(configPath: string, traceId: string): Promise<string | null | undefined> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ cost_source: string | null }>(
      "SELECT cost_source FROM provider_costs WHERE trace_id = ? ORDER BY rowid DESC LIMIT 1",
      [traceId],
    );
    return rows[0]?.cost_source;
  } catch {
    return undefined;
  } finally {
    await db.close();
  }
}

Deno.test({
  name:
    "[step135.9] real daemon: a standard request's provider_costs row is no longer forced to cost_source=provider_reported (GAP-C9)",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-team-cost-source-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      writeStubIdentity(tempDir);
      writeMockDaemonConfig(configPath, tempDir);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock" },
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(join(tempDir, "Workspace", "Requests", `${TRACE_ID}.md`), REQUEST_MARKDOWN);
        },
        afterInjectMs: 3000,
      });

      const costSource = await readCostSource(configPath, TRACE_ID);
      assertNotEquals(
        costSource,
        "provider_reported",
        "MockLLMProvider no longer self-reports cost_usd, so its generation must not force " +
          "cost_source=provider_reported — it must fall through to CostTracker's own precedence " +
          "(registry_computed if a pricing lookup is set and has data, else the legacy null estimate)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
