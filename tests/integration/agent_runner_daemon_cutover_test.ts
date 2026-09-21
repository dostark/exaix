/**
 * @module AgentRunnerDaemonCutoverTest
 * @path tests/integration/agent_runner_daemon_cutover_test.ts
 * @description Phase 180 Step 7 (Integration & Cutover) — proves the phase's rename and new
 *   instrumentation are reachable from real, observable runs, not package-unit tests alone.
 *   (1) A fresh `.exa/journal.db`, migrated for real via `scripts/setup_db.ts`, has `runner_kind`
 *   not `agent_kind`. (2) A real booted daemon process (not an in-process mock) processing a
 *   real Request file produces an Activity Journal row tagged `runner_kind: "agent-runner"` —
 *   complementing the in-process, real-DB proof already added in Step 5
 *   (packages/request/tests/processor_agent_runner_journal_test.ts) by additionally proving the
 *   daemon's own bootstrap wiring (apps/daemon/main.ts's real EventLogger/context.display, not a
 *   test-constructed one) carries the field through end to end. (3) `AgentComposer`, constructed
 *   with a real (non-mocked) `EventLogger` + SQLite `DatabaseService`, produces a real Activity
 *   Journal row tagged `runner_kind: "agent-composer"` — this one stops short of a full
 *   daemon-subprocess flow execution (which would additionally require discovering and wiring a
 *   flow YAML's per-step `strategy` field to route through `AgentComposerAdapter.runWithStrategy`
 *   rather than its default `IAgentRunner`-delegating bridge), a disproportionate lift given
 *   Steps 2/3 already fully verify `AgentComposer`'s tagging correctness at the class level.
 *   (4) A real daemon boot also emits `context.budget.allocated` with a real, model-derived
 *   `maxContextTokens` for the planning call — proving `apps/daemon/main.ts`'s real
 *   `PromptBudgetAllocator`/`ContextBudgetManager` wiring is reachable, not just unit-tested.
 * @architectural-layer Integration
 * @related-files [apps/daemon/main.ts, packages/request/src/processor.ts, packages/request/src/router.ts, packages/execution/src/agent_composer.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService, createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { Database } from "@db/sqlite";
import { EventLogger } from "@exaix/core/logger";
import { AgentComposer } from "@exaix/execution";
import { MIN_COST_TARGET_TOKENS_PER_REQUEST } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import {
  bootRealDaemon,
  daemonConfigSections,
  migrateDaemonWorkspace,
  writeDaemonConfigWithMockAi,
} from "./helpers/daemon_config.ts";

/** Mock-AI daemon config with the request quality gate disabled — a minimal test request body
 *  would otherwise score too low on actionability and get rejected before ever reaching
 *  agentRunner.run(), which is what this test needs to exercise. */
function writeDaemonConfigWithMockAiNoQualityGate(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Repo root, from `tests/integration/` — the source of the real `mock-agent` blueprint. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..");

interface IActivityRow {
  action_type: string;
  runner_kind: string | null;
  trace_id: string | null;
  payload: string;
}

async function readActivity(configPath: string): Promise<IActivityRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, runner_kind, trace_id, payload FROM activity ORDER BY rowid ASC",
    );
  } finally {
    await db.close();
  }
}

Deno.test({
  name: "[phase180-cutover] a freshly migrated .exa/journal.db has runner_kind, not agent_kind, in its activity table",
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase180-schema-cutover-" });
    try {
      await migrateDaemonWorkspace(tempDir);
      const configPath = join(tempDir, "exa.config.toml");
      writeDaemonConfigWithMockAi(configPath, tempDir);
      const configService = new ConfigService(configPath);
      const db = new DatabaseService(configService.getAll());
      try {
        const columns = await db.preparedAll<{ name: string }>("PRAGMA table_info(activity);");
        const names = columns.map((c) => c.name);
        assert(names.includes("runner_kind"), `activity table must have runner_kind, got: ${names.join(", ")}`);
        assert(!names.includes("agent_kind"), `activity table must NOT have agent_kind, got: ${names.join(", ")}`);
      } finally {
        await db.close();
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[phase180-cutover] a real daemon boot processing a real Request file produces an activity row, scoped to the request's own trace_id, with runner_kind = agent-runner",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase180-agent-runner-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAiNoQualityGate(configPath, tempDir);

    try {
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.copyFile(
        join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
        join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
      );

      const traceId = crypto.randomUUID();
      const requestPath = join(tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`);

      await bootRealDaemon(configPath, 2000, {
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(
            requestPath,
            `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
source: cli
created_by: "test@example.com"
subject: "Phase 180 cutover test request"
---

# Request

Add a hello world function.
`,
          );
        },
        afterInjectMs: 15000,
        waitForAfterInject: async () => {
          const rows = await readActivity(configPath);
          return rows.some((a) =>
            a.trace_id === traceId && a.action_type === "agent.execution_started" && a.runner_kind
          );
        },
      });

      const activities = await readActivity(configPath);
      const started = activities.filter((a) => a.trace_id === traceId).find((a) =>
        a.action_type === "agent.execution_started" && a.runner_kind
      );
      assert(
        started,
        `a queryable activity row for agent.execution_started with runner_kind, scoped to trace_id ${traceId}, must exist. got: ${
          JSON.stringify(activities)
        }`,
      );
      assert(
        started!.runner_kind === "agent-runner",
        `expected runner_kind "agent-runner", got "${started!.runner_kind}"`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[context-budget-cutover] a real daemon boot processing a real Request file emits context.budget.allocated for the planning call, with a model-derived maxContextTokens",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "context-budget-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAiNoQualityGate(configPath, tempDir);

    try {
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.copyFile(
        join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
        join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
      );

      const traceId = crypto.randomUUID();
      const requestPath = join(tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`);

      await bootRealDaemon(configPath, 2000, {
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(
            requestPath,
            `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
source: cli
created_by: "test@example.com"
subject: "context-budget cutover test request"
---

# Request

Add a hello world function.
`,
          );
        },
        afterInjectMs: 15000,
        waitForAfterInject: async () => {
          const rows = await readActivity(configPath);
          return rows.some((a) => a.trace_id === traceId && a.action_type === "context.budget.allocated");
        },
      });

      const activities = await readActivity(configPath);
      const allocated = activities.find((a) => a.trace_id === traceId && a.action_type === "context.budget.allocated");
      assert(
        allocated,
        `a queryable context.budget.allocated activity row scoped to trace_id ${traceId} must exist. got: ${
          JSON.stringify(activities)
        }`,
      );
      const payload = JSON.parse(allocated!.payload) as { maxContextTokens: number };
      assert(
        payload.maxContextTokens !== Number.MAX_SAFE_INTEGER && typeof payload.maxContextTokens === "number",
        `expected a real, model-derived maxContextTokens, got ${payload.maxContextTokens}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test(
  "[phase180-cutover] AgentComposer, with a real EventLogger + SQLite DatabaseService, produces an activity row with runner_kind = agent-composer",
  async () => {
    const { db, cleanup } = await initTestDbService();
    try {
      const logger = new EventLogger({ db });
      const traceId = crypto.randomUUID();
      const composer = new AgentComposer({
        config: { system: { root: "/tmp" } } as never,
        db: db as never,
        logger,
        pathResolver: {} as never,
        permissions: {} as never,
      });

      await composer.logExecutionStart(traceId, "senior-coder", "test-portal");
      await db.waitForFlush();

      const activities = db.getActivitiesByTrace(traceId);
      const started = activities.find((a) => a.action_type === "agent.execution_started");
      assert(
        started,
        `a queryable activity row for agent.execution_started must exist. got: ${JSON.stringify(activities)}`,
      );
      assert(
        started!.runner_kind === "agent-composer",
        `expected runner_kind "agent-composer", got "${started!.runner_kind}"`,
      );
    } finally {
      await cleanup();
    }
  },
);

/** Real daemon-boot proof of cost-ceiling enforcement for the planning call under IDENTICAL
 *  inputs through the PUBLIC config path: the constrained run must produce a strictly smaller
 *  final prompt (`usedInputTokens`) than the unconstrained run on identical fixture + request. */

const EXACT_FIT_PORTAL_FILE_COUNT = 140;

/** Writes the shared portal fixture once; both runs reuse it. The file count is high enough
 *  that the assembled portal listing exceeds the section budget a validated low ceiling
 *  allocates, guaranteeing the strict final-token reduction the cutover asserts. */
async function writeSharedPortalFixture(portalDir: string): Promise<void> {
  await Deno.mkdir(join(portalDir, "src"), { recursive: true });
  for (let i = 0; i < EXACT_FIT_PORTAL_FILE_COUNT; i++) {
    await Deno.writeTextFile(
      join(portalDir, "src", `${String(i).padStart(4, "0")}-module-file.ts`),
      "// fixture module with a meaningful body so the listing segment is non-trivial.\n" +
        "export function moduleFunction(): string { return `module-${Date.now()}`; }\n",
    );
  }
}

/** Daemon TOML with a portal mount and NO budget section — the cost ceiling is applied
 *  exclusively through the persisted public `budget.cost_target_tokens_per_request` key in
 *  `.exa/config.db` (the `exactl config set` surface), never a private camelCase TOML field. */
function writeDaemonConfigWithPortal(configPath: string, root: string, portalDir: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[[portals]]",
    'alias = "cutover-portal"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Parsed `context.budget.consumed` payload fields this cutover test asserts on. */
interface IBudgetConsumedPayload {
  droppedSegmentCount: number;
  usedInputTokens: number;
}

interface IBudgetEventRow {
  action_type: string;
  payload: IBudgetConsumedPayload;
}

/** Parses trace-scoped compaction evidence: whether ANY segment was dropped or trimmed
 *  under the configured ceiling, plus the final usedInputTokens total. */
interface IBudgetCampaignEvidence {
  campaignEvents: IBudgetEventRow[];
  consumed: IBudgetConsumedPayload;
  anyCompaction: boolean;
}

async function collectBudgetEvents(
  configPath: string,
): Promise<IBudgetEventRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ action_type: string; payload: string }>(
      "SELECT action_type, payload FROM activity WHERE action_type IN ('context.budget.consumed','context.section.truncated') ORDER BY rowid ASC",
    );
    return rows.map((r) => ({
      action_type: r.action_type,
      payload: JSON.parse(r.payload) as IBudgetConsumedPayload,
    }));
  } finally {
    await db.close();
  }
}

function makePortalRequestAndBoot(
  tempDir: string,
): { traceId: string; requestPath: string } {
  const traceId = crypto.randomUUID();
  const requestPath = join(tempDir, "Workspace", "Requests", `r-${traceId.slice(0, 8)}.md`);
  return { traceId, requestPath };
}

/** Same immutable portal fixture + byte-identical Request for both the constrained and
 *  unconstrained runs, so any observed difference is attributable to the ceiling alone.
 *  Both runs mount the SAME absolute fixture path, so the listing token counts match exactly. */
async function bootPortalRequestRun(
  tempDir: string,
  sharedPortalDir: string,
  publicCostTarget: number | null,
): Promise<IBudgetCampaignEvidence> {
  const configPath = join(tempDir, "exa.config.toml");
  // The ceiling is applied ONLY via the persisted public config key, never a TOML field.
  writeDaemonConfigWithPortal(configPath, tempDir, sharedPortalDir);

  if (publicCostTarget !== null) {
    // Mirrors `exactl config set` against an already-booted workspace: seed the Config DB
    // first (as a prior boot would), then write the override — a fresh-DB set would be
    // masked by the boot-time seed's higher-id NULL init row.
    const configDbPath = ensureConfigDb(tempDir);
    const db = new Database(configDbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
    } finally {
      db.close();
    }
    const adapter = createConfigAdapter(configDbPath);
    await adapter.set("budget.cost_target_tokens_per_request", publicCostTarget, {
      swap_class: "restart",
    });
    (adapter as { close?: () => void }).close?.();
  }

  await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
  await Deno.copyFile(
    join(Deno.cwd(), "Blueprints", "Agents", "mock-agent.md"),
    join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
  );
  const { traceId, requestPath } = makePortalRequestAndBoot(tempDir);
  await bootRealDaemon(configPath, 2000, {
    midFlight: () => {
      Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
      Deno.writeTextFileSync(
        requestPath,
        `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
portal: cutover-portal
source: cli
created_by: "test@example.com"
subject: "cost ceiling cutover probe"
---

# Request

Add a hello world function to src/0000-module-file.ts.
`,
      );
    },
    afterInjectMs: 25000,
    waitForAfterInject: async () => (await collectBudgetEvents(configPath)).length > 0,
  });
  const campaignEvents = await collectBudgetEvents(configPath);
  const consumed = campaignEvents.find((e) => e.action_type === "context.budget.consumed");
  assert(consumed, `run (costTarget=${publicCostTarget}) must journal context.budget.consumed for the planning call`);
  return {
    campaignEvents,
    consumed: {
      droppedSegmentCount: Number(consumed.payload["droppedSegmentCount"]),
      usedInputTokens: Number(consumed.payload["usedInputTokens"]),
    },
    anyCompaction: campaignEvents.some((e) =>
      e.action_type === "context.section.truncated" || Number(e.payload["droppedSegmentCount"]) > 0
    ),
  };
}

Deno.test({
  name:
    "[phase196-costcutover] identical-input daemon pair shows the constrained run's final assembled prompt strictly below the unconstrained run via the public config path + restart boundary",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const sharedDir = await Deno.makeTempDir({ prefix: "step16-run-" });
    const constrainedDir = await Deno.makeTempDir({ prefix: "step16-constrained-" });
    const unconstrainedDir = await Deno.makeTempDir({ prefix: "step16-unconstrained-" });
    try {
      // ONE shared fixture mounted at the SAME absolute path by both daemons — byte-identical
      // portal contents and request, so any observed difference is attributable to the ceiling.
      const sharedPortal = join(sharedDir, "fixture-portal");
      await writeSharedPortalFixture(sharedPortal);

      // Validated low ceiling (>= MIN_COST_TARGET_TOKENS_PER_REQUEST) low enough that the large
      // portal listing overflows its section budget — the constrained run must compact a segment.
      const publicTarget = MIN_COST_TARGET_TOKENS_PER_REQUEST;
      assert(
        publicTarget >= 5043,
        "the public ceiling must be a validated feasible value (above the allocator section-floor total)",
      );

      const constrained = await bootPortalRequestRun(
        constrainedDir,
        sharedPortal,
        publicTarget,
      );
      const unconstrained = await bootPortalRequestRun(
        unconstrainedDir,
        sharedPortal,
        null,
      );

      // Strict final-token reduction on identical inputs (the primary observable, not just
      // a non-zero drop count).
      assert(
        constrained.consumed.usedInputTokens < unconstrained.consumed.usedInputTokens,
        `constrained usedInputTokens (${constrained.consumed.usedInputTokens}) must be strictly below the ` +
          `unconstrained total (${unconstrained.consumed.usedInputTokens}) for identical inputs`,
      );
      // The constrained run actually compacted a planning segment (dropped OR trimmed under
      // the low ceiling — evidenced by a truncated-section event), while the unconstrained
      // run keeps every segment.
      assert(
        constrained.anyCompaction,
        `constrained run (public costTarget=${publicTarget}) must compact a planning-call segment ` +
          `(drop or trim), got dropped=${constrained.consumed.droppedSegmentCount}, events=${
            JSON.stringify(
              constrained.campaignEvents.map((e) => e.action_type),
            )
          }`,
      );
      assert(
        !unconstrained.anyCompaction,
        `unconstrained run must keep every segment (no drop/trim), got events=${
          JSON.stringify(
            unconstrained.campaignEvents.map((e) => e.action_type),
          )
        }`,
      );
      console.log(
        `[phase196-costcutover] constrained public costTarget=${publicTarget} → usedInputTokens=${constrained.consumed.usedInputTokens} (dropped ${constrained.consumed.droppedSegmentCount}); ` +
          `unconstrained → ${unconstrained.consumed.usedInputTokens} (dropped ${unconstrained.consumed.droppedSegmentCount})`,
      );
    } finally {
      await Deno.remove(sharedDir, { recursive: true }).catch(() => {});
      await Deno.remove(constrainedDir, { recursive: true }).catch(() => {});
      await Deno.remove(unconstrainedDir, { recursive: true }).catch(() => {});
    }
  },
});
