/**
 * @module ModelRegistryRouteAdmitLiveTest
 * @path tests/integration/model_registry_route_admit_live_test.ts
 * @description Phase 135 Reachability Ledger — closes `route-auto-admit-live-proof`.
 *   `TeamResolutionStrategy.selectRoute` (2-route policy) and `validateExplicit`
 *   (explicit-unadmitted-model auto-admit) already had unit/integration coverage in
 *   isolation (`model_route_selection_test.ts`, `admission_test.ts`) and are reached
 *   via the `IResolutionStrategy` seam Step 9 confirmed live for `best_ranked` — but
 *   Step 9's daemon-boot scenario did not additionally construct a 2-route or
 *   explicit-unadmitted-model fixture. This file proves both sub-behaviors fire on a
 *   REAL booted daemon subprocess, the same harness as
 *   `model_registry_team_cutover_test.ts` (mock LLM provider, stub catalog HTTP
 *   servers — no real network/API keys).
 *
 *   Two-route: the stub OpenAI server is made to also serve Anthropic's
 *   `claude-stub-curated` model id, so `model_catalog` gets two rows for one model
 *   name after refresh_on_start. The identity carries model_size but no explicit model,
 *   so ModelResolver falls through tryResolveCurated (no model_presets.M.candidates
 *   configured) to the scored resolveOnce path, whose model_registry.getModelsByCapability
 *   lookup resolves the winning provider's model to the real catalog entry
 *   "claude-stub-curated" — then `route_policy = "cheapest"` (default) picks a route and
 *   emits `model.route.selected` with `policy: "cheapest"`, carried onto `model.resolved`
 *   as `route_reason: "cheapest"`.
 *
 *   Explicit-unadmit: `[model_registry.admission] keep_native_whole = false` stops the
 *   scheduled refresh from admitting every native model up front, so
 *   `claude-stub-explicit-use` (served by the stub but never curated) stays genuinely
 *   unadmitted until a plan step's identity blueprint names it explicitly
 *   (`model: "anthropic:claude-stub-explicit-use"`) — driving
 *   `ModelResolver.tryResolveExplicit` -> `validateExplicit`'s live re-fetch-and-admit
 *   path, which journals `model.admitted{reason: "explicit_use"}`.
 * @architectural-layer Test
 * @related-files [packages/ai/src/model_resolver.ts, packages-team/model-registry-live/src/team_resolution_strategy.ts, packages-team/model-registry-live/src/adapters/admission.ts, tests/integration/model_registry_team_cutover_test.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { bootRealDaemon, daemonConfigSections, writePortalDir } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";
import { type IStubCatalogServer, shutdownAll, startAllStubCatalogServers } from "./helpers/stub_catalog_servers.ts";

const TWO_ROUTE_TRACE_ID = "22222222-2222-4222-8222-222222222222";
const TWO_ROUTE_REQUEST_ID = "step135-ledger-2route-req";
const EXPLICIT_TRACE_ID = "33333333-3333-4333-8333-333333333333";
const EXPLICIT_REQUEST_ID = "step135-ledger-explicit-req";

// NO explicit model, just model_size: M — forces ModelResolver's scored resolveOnce path
// (not tryResolveCurated, which returns null with no model_presets.M.candidates configured).
// resolveOnce's getModelsByCapability lookup swaps in the real catalog entry so routesFor finds 2 rows.
function writeTwoRouteIdentity(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(dir, { recursive: true });
  const frontmatter = [
    "---",
    'identity_id: "stub-two-route"',
    'model: ""',
    "model_size: M",
    "permitted_tools:",
    "  - write_file",
    "---",
    "",
    "You are a stub agent for testing 2-route model resolution.",
    "",
  ].join("\n");
  Deno.writeTextFileSync(join(dir, "stub-two-route.md"), frontmatter);
}

function writeExplicitIdentity(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(dir, { recursive: true });
  const frontmatter = [
    "---",
    'identity_id: "stub-explicit"',
    'model: "anthropic:claude-stub-explicit-use"',
    "permitted_tools:",
    "  - write_file",
    "---",
    "",
    "You are a stub agent for testing explicit-unadmitted-model auto-admit.",
    "",
  ].join("\n");
  Deno.writeTextFileSync(join(dir, "stub-explicit.md"), frontmatter);
}

function writeStructuredPlan(
  root: string,
  fileName: string,
  traceId: string,
  requestId: string,
  identityId: string,
): void {
  const dir = join(root, "Workspace", "Active");
  Deno.mkdirSync(dir, { recursive: true });
  const content = [
    "---",
    `trace_id: "${traceId}"`,
    `request_id: "${requestId}"`,
    `identity_id: ${identityId}`,
    'portal: "workspace"',
    "status: approved",
    `created_at: "${new Date().toISOString()}"`,
    "---",
    "",
    "# Proposed Plan",
    "",
    "## Execution Steps",
    "",
    "## Step 1: Write a test file",
    "",
    'Use the write_file tool to create test.txt with content "hello".',
    "",
    "## Reasoning",
    "",
    "Testing structured plan execution with route/admission resolution.",
    "",
  ].join("\n");
  Deno.writeTextFileSync(join(dir, fileName), content);
}

// Team config: adapter stubs, refresh-on-start, a `workspace` portal. `keepNativeWhole` TRUE
// (2-route case) pre-admits both providers' colliding-model entries; FALSE (explicit-unadmit
// case) leaves it unadmitted until live auto-admit. `withModelSizePreset` forces the scored resolveOnce path.
function writeTeamConfig(
  configPath: string,
  root: string,
  portalDir: string,
  adapterBaseUrls: Record<string, string>,
  keepNativeWhole: boolean,
  withModelSizePreset?: boolean,
): void {
  const overrideLines = Object.entries(adapterBaseUrls).map(([provider, url]) => `${provider} = "${url}"`);
  const presetLines = withModelSizePreset
    ? [
      "",
      "[model_presets.M]",
      "max_cost_per_mtok = 100",
      "min_context_window = 1",
      "supports_thinking = false",
    ]
    : [];
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
    "[[portals]]",
    'alias = "workspace"',
    `target_path = "${portalDir}"`,
    "",
    "[model_registry]",
    "enabled = true",
    "refresh_on_start = true",
    "",
    "[model_registry.admission]",
    `keep_native_whole = ${keepNativeWhole}`,
    "",
    "[model_registry.adapter_base_urls]",
    ...overrideLines,
    ...presetLines,
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
      "SELECT action_type, payload FROM activity WHERE action_type = ? ORDER BY rowid ASC",
      [actionType],
    );
  } catch {
    return [];
  } finally {
    await db.close();
  }
}

Deno.test({
  name:
    "[reachability-ledger] real Team daemon: a 2-route model resolves via route_policy=cheapest and emits model.route.selected",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-2route-" });
    const configPath = join(tempDir, "exa.config.toml");
    let stubs: IStubCatalogServer[] = [];
    try {
      // collidingModel: the OpenAI stub also serves Anthropic's curated model id, so
      // model_catalog ends up with two provider rows for the same model name.
      const started = startAllStubCatalogServers(undefined, { collidingModel: "claude-stub-curated" });
      stubs = started.servers;

      await runMigrationsIn(tempDir);
      writeTwoRouteIdentity(tempDir);
      const portalDir = writePortalDir(tempDir);
      writeTeamConfig(configPath, tempDir, portalDir, started.adapterBaseUrls, true, true);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" },
        midFlight: () =>
          writeStructuredPlan(
            tempDir,
            "two-route-test_plan.md",
            TWO_ROUTE_TRACE_ID,
            TWO_ROUTE_REQUEST_ID,
            "stub-two-route",
          ),
        afterInjectMs: 3000,
      });

      const routeEvents = await readEvents(configPath, "model.route.selected");
      assertEquals(
        routeEvents.length > 0,
        true,
        "model.route.selected must appear in the journal — a 2-route model must trigger the route sub-step",
      );
      const routePayload = JSON.parse(routeEvents[0].payload ?? "{}") as {
        chosen_provider?: string;
        policy?: string;
      };
      assertEquals(routePayload.policy, "cheapest");
      assertExists(routePayload.chosen_provider);

      const resolvedEvents = await readEvents(configPath, "model.resolved");
      assertEquals(resolvedEvents.length > 0, true, "ModelResolver.resolve() must have been called");
      const lastResolved = resolvedEvents[resolvedEvents.length - 1];
      const resolvedPayload = JSON.parse(lastResolved.payload ?? "{}") as { route_reason?: string };
      assertEquals(
        resolvedPayload.route_reason,
        "cheapest",
        "model.resolved must carry the route sub-step's decision, not single_route",
      );
    } finally {
      await shutdownAll(stubs);
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[reachability-ledger] real Team daemon: an explicit unadmitted-but-real model auto-admits and emits model.admitted{reason:explicit_use}",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-explicit-admit-" });
    const configPath = join(tempDir, "exa.config.toml");
    let stubs: IStubCatalogServer[] = [];
    try {
      const started = startAllStubCatalogServers();
      stubs = started.servers;

      await runMigrationsIn(tempDir);
      writeExplicitIdentity(tempDir);
      const portalDir = writePortalDir(tempDir);
      writeTeamConfig(configPath, tempDir, portalDir, started.adapterBaseUrls, false);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" },
        midFlight: () =>
          writeStructuredPlan(
            tempDir,
            "explicit-admit-test_plan.md",
            EXPLICIT_TRACE_ID,
            EXPLICIT_REQUEST_ID,
            "stub-explicit",
          ),
        afterInjectMs: 3000,
      });

      const admittedEvents = await readEvents(configPath, "model.admitted");
      const explicitUseEvent = admittedEvents.find((e) => {
        const payload = JSON.parse(e.payload ?? "{}") as { reason?: string; model?: string };
        return payload.reason === "explicit_use" && payload.model === "claude-stub-explicit-use";
      });
      assertExists(
        explicitUseEvent,
        "model.admitted{reason: explicit_use, model: claude-stub-explicit-use} must appear — " +
          "keep_native_whole=false means the scheduled refresh does not pre-admit this model, so only " +
          "the explicit plan step's ModelResolver.tryResolveExplicit -> validateExplicit auto-admit path can",
      );

      const resolvedEvents = await readEvents(configPath, "model.resolved");
      assertEquals(resolvedEvents.length > 0, true, "ModelResolver.resolve() must have been called");
      const lastResolved = resolvedEvents[resolvedEvents.length - 1];
      const resolvedPayload = JSON.parse(lastResolved.payload ?? "{}") as { reason?: string };
      assertEquals(
        resolvedPayload.reason,
        "explicit_override",
        "the explicit intent.model path resolves with reason explicit_override on model.resolved " +
          "(explicit_use is the admission reason on model.admitted, a distinct event)",
      );
    } finally {
      await shutdownAll(stubs);
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
