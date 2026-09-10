/**
 * @module ModelRegistryTeamCostSourceTest
 * @path tests/integration/model_registry_team_cost_source_test.ts
 * @description Phase 135 Step 9 (GAP-C9) — proves, on a REAL booted daemon subprocess,
 *   that a standard agent-role request's `provider_costs` row is no longer forced to
 *   `cost_source: "provider_reported"` by the mock provider. Two real production bugs
 *   were found and fixed while building this proof: (a) RequestProcessor built its own
 *   CostTracker with no pricing lookup ever set (fixed: apps/daemon/main.ts now passes
 *   the daemon's own tracker, which DOES get `setPricingLookup(modelRegistry)`), and
 *   (b) MockLLMProvider always self-reported `cost_usd: 0`, which forced
 *   `cost_source: "provider_reported"` upstream of CostTracker's own precedence logic
 *   (fixed: the mock no longer reports a cost at all).
 *
 *   Reachability Ledger follow-up: the second test below proves
 *   `cost_source: "registry_computed"` itself. The standard agent-role-request path
 *   resolves via `agents.default_model`/`ai.provider`, tied to the `mock` provider TYPE —
 *   `setPricingLookup`'s `getModelPricing(provider, model)` lookup is a pure parameterized
 *   `SELECT ... WHERE provider = ? AND model = ?` with no provider-type filtering, so a
 *   `model_pricing` row seeded for `("mock", "mock-model")` — the exact
 *   provider/model string the mock provider always reports — resolves through it on a
 *   real `EXAIX_EDITION=team` boot without needing a real (non-mock) AI provider.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/core/src/cost/cost_tracker.ts, packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/rate_limited_provider.ts, exaix-team/packages/model-registry-live/src/model_registry_service.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
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
  "agent_role: stub-agent",
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

function writeStubAgentRole(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
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

// RateLimitedProvider.generate never passes traceId to CostTracker.trackGeneration on this
// path, so every provider_costs row has trace_id = NULL; filtering by traceId would match
// nothing. Read the latest row instead — safe since each test uses its own fresh tempDir/daemon.
async function readCostSource(configPath: string): Promise<string | null | undefined> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ cost_source: string | null }>(
      "SELECT cost_source FROM provider_costs ORDER BY rowid DESC LIMIT 1",
    );
    return rows[0]?.cost_source;
  } catch {
    return undefined;
  } finally {
    await db.close();
  }
}

/** Team config: model_registry enabled (wires the live pricing lookup), no adapter stubs needed
 * (refresh_on_start left false — this test seeds model_pricing directly rather than fetching). */
function writeTeamDaemonConfig(configPath: string, root: string): void {
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
    "[model_registry]",
    "enabled = true",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

// Seeds model_pricing directly (no network fetch); mirrors model_route_selection_test.ts's
// seedRoute helper. "mock"/"mock-model" must match MockLLMProvider's reported identity and
// config.agents.default_model exactly, since the pricing lookup keys on provider+model.
async function seedMockPricing(configPath: string): Promise<void> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    await db.preparedRun(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at)
       VALUES (?, ?, ?, ?, 'endpoint', ?)`,
      ["mock", "mock-model", 1, 2, Date.now()],
    );
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
      writeStubAgentRole(tempDir);
      writeMockDaemonConfig(configPath, tempDir);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock" },
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(join(tempDir, "Workspace", "Requests", `${TRACE_ID}.md`), REQUEST_MARKDOWN);
        },
        afterInjectMs: 12000,
        waitForAfterInject: async () => (await readCostSource(configPath)) != null,
      });

      const costSource = await readCostSource(configPath);
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

const REGISTRY_COMPUTED_TRACE_ID = "step135-ledger-cost-source-live-trace";
const REGISTRY_COMPUTED_REQUEST_MARKDOWN = [
  "---",
  `trace_id: "${REGISTRY_COMPUTED_TRACE_ID}"`,
  `created: "${new Date().toISOString()}"`,
  "status: pending",
  "priority: 5",
  "agent_role: stub-agent",
  "source: test",
  "created_by: model_registry_team_cost_source_test",
  "tags: []",
  "---",
  "",
  "# Request",
  "",
  "Add a short docstring to the isOdd helper function.",
  "",
].join("\n");

Deno.test({
  name:
    "[reachability-ledger] real Team daemon: a standard request's provider_costs row is cost_source=registry_computed when the resolved provider:model is priced",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-team-cost-source-live-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      writeStubAgentRole(tempDir);
      writeTeamDaemonConfig(configPath, tempDir);
      await seedMockPricing(configPath);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" },
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(
            join(tempDir, "Workspace", "Requests", `${REGISTRY_COMPUTED_TRACE_ID}.md`),
            REGISTRY_COMPUTED_REQUEST_MARKDOWN,
          );
        },
        afterInjectMs: 12000,
        waitForAfterInject: async () => (await readCostSource(configPath)) === "registry_computed",
      });

      const costSource = await readCostSource(configPath);
      assertEquals(
        costSource,
        "registry_computed",
        "with EXAIX_EDITION=team (live ModelRegistryService pricing lookup wired) and a seeded " +
          "model_pricing row for mock:mock-model (the exact provider/model the standard request " +
          "path resolves to and MockLLMProvider always reports), CostTracker.resolveCost's " +
          "computeSplitPrice branch must find a priced model and win over the legacy null estimate",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
