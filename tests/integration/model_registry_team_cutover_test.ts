/**
 * @module ModelRegistryTeamCutoverTest
 * @path tests/integration/model_registry_team_cutover_test.ts
 * @description Phase 135 Step 9 — the Team daemon proof: on a REAL booted daemon
 *   subprocess (EXAIX_EDITION=team, model_registry.enabled=true, all five catalog
 *   adapters pointed at local stub HTTP servers via model_registry.adapter_base_urls),
 *   one scheduler refresh cycle (refresh_on_start) admits stub catalog entries, and a
 *   structured-plan execution for an agent role with `characteristics: ["best"]` resolves
 *   via ModelResolver with `reason: "best_ranked"` — all asserted via the Activity
 *   Journal on the real daemon lifecycle (`exactl logs` reads the same table).
 *
 *   This test exists only because three production gaps were found and fixed while
 *   building it (Phase 135 Step 9, GAP-C9):
 *   1. `apps/daemon/main.ts` constructed ExecutionLoop with no `logger` — silencing
 *      every plan-execution event (including model.resolved) from the journal.
 *   2. `packages/core/src/planning/plan_executor.ts`'s `createAgentExecutor` never
 *      passed `modelResolver` to `AgentOrchestrator` at all — ModelResolver.resolve() (the
 *      only path to best/route/auto-admit/task_type) was production-dead for every
 *      plan execution, independent of agent role blueprint content.
 *   3. `model_registry.adapter_base_urls` (this step) — a test-only seam letting a real
 *      daemon subprocess point its catalog adapters at local stub servers instead of
 *      the vendor hosts.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/execution/src/execution_loop.ts, packages/core/src/planning/plan_executor.ts, packages/ai/src/model_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { bootRealDaemon, daemonConfigSections, writePortalDir } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";
import { type IStubCatalogServer, shutdownAll, startAllStubCatalogServers } from "./helpers/stub_catalog_servers.ts";

const TRACE_ID = "12121212-1212-4121-8121-121212121212";
const REQUEST_ID = "step135-9-cutover-req";

function writeStubAgentRole(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(dir, { recursive: true });
  const frontmatter = [
    "---",
    'agent_role: "stub-best"',
    'model: ""',
    'characteristics: ["best"]',
    "task_type: feature",
    "permitted_tools:",
    "  - write_file",
    "---",
    "",
    "You are a stub agent for testing best-ranked model resolution.",
    "",
  ].join("\n");
  Deno.writeTextFileSync(join(dir, "stub-best.md"), frontmatter);
}

function writeStructuredPlan(root: string): void {
  const dir = join(root, "Workspace", "Active");
  Deno.mkdirSync(dir, { recursive: true });
  const content = [
    "---",
    `trace_id: "${TRACE_ID}"`,
    `request_id: "${REQUEST_ID}"`,
    "agent_role: stub-best",
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
    "Testing structured plan execution with best-ranked model resolution.",
    "",
  ].join("\n");
  Deno.writeTextFileSync(join(dir, "cutover-test_plan.md"), content);
}

/** Team config: adapter stubs, refresh-on-start, and a `workspace` portal (required by AgentOrchestrator). */
function writeTeamConfig(
  configPath: string,
  root: string,
  portalDir: string,
  adapterBaseUrls: Record<string, string>,
): void {
  const overrideLines = Object.entries(adapterBaseUrls).map(([provider, url]) => `${provider} = "${url}"`);
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

async function readLastEvent(configPath: string, actionType: string): Promise<IJournalEvent | undefined> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<IJournalEvent>(
      "SELECT action_type, payload FROM activity WHERE action_type = ? ORDER BY rowid DESC LIMIT 1",
      [actionType],
    );
    return rows[0];
  } catch {
    return undefined;
  } finally {
    await db.close();
  }
}

Deno.test({
  name:
    "[step135.9] real Team daemon: a best-characteristic plan step resolves via ModelResolver with reason=best_ranked (GAP-C9)",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-team-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    let stubs: IStubCatalogServer[] = [];
    try {
      const started = startAllStubCatalogServers();
      stubs = started.servers;

      await runMigrationsIn(tempDir);
      writeStubAgentRole(tempDir);
      const portalDir = writePortalDir(tempDir);
      writeTeamConfig(configPath, tempDir, portalDir, started.adapterBaseUrls);

      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" },
        midFlight: () => writeStructuredPlan(tempDir),
        afterInjectMs: 3000,
      });

      const resolvedEvent = await readLastEvent(configPath, "model.resolved");
      if (!resolvedEvent) {
        throw new Error("model.resolved must appear in the journal — ModelResolver.resolve() was not reached");
      }
      const payload = JSON.parse(resolvedEvent.payload ?? "{}") as {
        reason?: string;
        task_type_source?: string;
        intent?: string;
      };
      assertEquals(
        payload.reason,
        "best_ranked",
        "a plan step for an agent role with characteristics=['best'] must resolve via the best scorer, " +
          "not a route/curated/legacy fallback reason",
      );
      assertEquals(
        payload.task_type_source,
        "agent_role",
        "task_type must derive from the agent role blueprint's own task_type field (5-tier precedence, Step 8)",
      );
    } finally {
      await shutdownAll(stubs);
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
