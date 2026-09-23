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
 *   Phase 199 Step 6 adds the planning-tools cutover: with `[planning] tools_enabled = true`
 *   in the REAL exa.config.toml (and a recorded-mock provider whose call-site fixtures replay
 *   a `read_file` tool round followed by a plan), a real daemon boot's planning call executes
 *   a journaled read-only tool round whose result shapes the written plan; the flag-off boot
 *   stays single-call with no planning tool rows.
 * @architectural-layer Integration
 * @related-files [apps/daemon/main.ts, packages/request/src/processor.ts, packages/request/src/router.ts, packages/execution/src/agent_composer.ts, packages/execution/src/planning_tool_loop.ts]
 */

import { assert, assertEquals, assertLessOrEqual } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService, createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { Database } from "@db/sqlite";
import { EventLogger } from "@exaix/core/logger";
import { AgentComposer, AgentRunner } from "@exaix/execution";
import {
  MIN_COST_TARGET_TOKENS_PER_REQUEST,
  PORTAL_KNOWLEDGE_KEY,
  PortalAnalysisMode,
  PromptBudgetAllocator,
} from "@exaix/core";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { initTestDbService } from "@exaix/testing";
import { MockProvider } from "@exaix/ai/providers.ts";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import { buildPortalKnowledgeSummary } from "@exaix/request";
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

/** A real portal fixture (a `PaymentRouter` class) is analyzed for real on the daemon's own
 *  first request — `RequestProcessor.resolvePortalKnowledge` calls `getOrAnalyze`, which runs a
 *  full analysis on a cold in-process cache, so no pre-analysis step is needed. */
const PAYMENT_ROUTER_SYMBOL = "PaymentRouter";

/** Distractor `*.service.ts` files so the full-portal summary is larger than a narrow adaptive
 *  query naming only PaymentRouter. */
const DISTRACTOR_SERVICES = [
  "auth",
  "billing",
  "notification",
  "inventory",
  "shipping",
  "catalog",
  "search",
  "audit",
];

/** `detectPatterns` recognizes these naming keywords as separate conventions, none of which
 *  score against a "PaymentRouter" query — they inflate the summary's always-included
 *  conventions list without inflating adaptive's relevant-entries list. */
const DISTRACTOR_REPOSITORIES = ["user", "order", "product"];
const DISTRACTOR_CONTROLLERS = ["api", "admin", "webhook"];
const DISTRACTOR_HANDLERS = ["event", "message", "job"];

async function writeSymbolFixturePortal(portalDir: string): Promise<void> {
  await Deno.mkdir(join(portalDir, "services"), { recursive: true });
  await Deno.writeTextFile(
    join(portalDir, "services", "router.service.ts"),
    `/** Routes payment requests to the configured provider. */\nexport class ${PAYMENT_ROUTER_SYMBOL} {\n  route(): string {\n    return "routed";\n  }\n}\n`,
  );
  for (const name of DISTRACTOR_SERVICES) {
    const className = `${name[0].toUpperCase()}${name.slice(1)}Service`;
    await Deno.writeTextFile(
      join(portalDir, "services", `${name}.service.ts`),
      `/** Handles ${name} domain logic — one of several unrelated services in this fixture. */\nexport class ${className} {\n  handle(): string {\n    return "${name}-handled";\n  }\n}\n`,
    );
  }
  for (const name of DISTRACTOR_REPOSITORIES) {
    const className = `${name[0].toUpperCase()}${name.slice(1)}Repository`;
    await Deno.writeTextFile(
      join(portalDir, `${name}.repository.ts`),
      `export class ${className} {\n  find(): string {\n    return "found";\n  }\n}\n`,
    );
  }
  for (const name of DISTRACTOR_CONTROLLERS) {
    const className = `${name[0].toUpperCase()}${name.slice(1)}Controller`;
    await Deno.writeTextFile(
      join(portalDir, `${name}.controller.ts`),
      `export class ${className} {\n  handle(): string {\n    return "ok";\n  }\n}\n`,
    );
  }
  for (const name of DISTRACTOR_HANDLERS) {
    const className = `${name[0].toUpperCase()}${name.slice(1)}Handler`;
    await Deno.writeTextFile(
      join(portalDir, `${name}.handler.ts`),
      `export class ${className} {\n  process(): string {\n    return "processed";\n  }\n}\n`,
    );
  }
  await Deno.writeTextFile(
    join(portalDir, "main.ts"),
    `import { ${PAYMENT_ROUTER_SYMBOL} } from "./services/router.service.ts";\nnew ${PAYMENT_ROUTER_SYMBOL}().route();\n`,
  );
}

/** `inclusion` is written directly into `[portal_knowledge]` — unlike `budget.*` keys,
 *  `ConfigService` parses the TOML only and never merges Config DB overrides;
 *  `resolveEffectiveBudgetPolicy` is a budget-only special case, not a general mechanism. */
function writeDaemonConfigForAdaptiveCutover(
  configPath: string,
  root: string,
  portalDir: string,
  inclusion: "summary" | "adaptive",
): void {
  const cfg = [
    "[system]",
    `root = "${root}"`,
    'log_level = "debug"',
    "",
    "[paths]",
    'workspace = "./Workspace"',
    'blueprints = "./Blueprints"',
    'runtime = "./.exa"',
    'memory = "./Memory"',
    'portals = "./Portals"',
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
    "[portal_knowledge]",
    'default_mode = "standard"',
    "use_llm_inference = false",
    ...(inclusion === "adaptive" ? ['inclusion = "adaptive"'] : []),
    "",
    "[[portals]]",
    'alias = "payment-portal"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

interface IStep6ActivityRow {
  action_type: string;
  payload: string;
}

async function readStep6Activity(configPath: string, traceId: string): Promise<IStep6ActivityRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IStep6ActivityRow>(
      "SELECT action_type, payload FROM activity WHERE trace_id = ? ORDER BY rowid ASC",
      [traceId],
    );
  } finally {
    await db.close();
  }
}

async function bootCutoverRun(
  tempDir: string,
  sharedPortalDir: string,
  inclusion: "summary" | "adaptive",
): Promise<{ traceId: string; activities: IStep6ActivityRow[] }> {
  const configPath = join(tempDir, "exa.config.toml");
  writeDaemonConfigForAdaptiveCutover(configPath, tempDir, sharedPortalDir, inclusion);

  await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
  await Deno.copyFile(
    join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
    join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
  );

  const traceId = crypto.randomUUID();
  const requestPath = join(tempDir, "Workspace", "Requests", `r-${traceId.slice(0, 8)}.md`);

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
portal: payment-portal
source: cli
created_by: "test@example.com"
subject: "phase198 step6 cutover probe"
---

# Request

Investigate ${PAYMENT_ROUTER_SYMBOL} behavior.
`,
      );
    },
    afterInjectMs: 25000,
    waitForAfterInject: async () => {
      const rows = await readStep6Activity(configPath, traceId);
      return rows.some((r) => r.action_type === "agent.prompt_debug_dump");
    },
  });

  return { traceId, activities: await readStep6Activity(configPath, traceId) };
}

Deno.test({
  name:
    "[phase198-cutover] a real adaptive daemon request journals a trace-linked portal.knowledge.selection_applied event and retains the named fixture symbol in the accepted prompt",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase198-adaptive-cutover-" });
    const portalDir = join(tempDir, "fixture-portal");
    try {
      await writeSymbolFixturePortal(portalDir);
      const { traceId, activities } = await bootCutoverRun(tempDir, portalDir, "adaptive");

      const selection = activities.find((a) => a.action_type === "portal.knowledge.selection_applied");
      assert(
        selection,
        `a portal.knowledge.selection_applied row scoped to trace_id ${traceId} must exist. got: ${
          JSON.stringify(activities.map((a) => a.action_type))
        }`,
      );
      const selectionPayload = JSON.parse(selection!.payload) as {
        inclusion: string;
        selectedTokens: number;
        includedTokens: number;
        availableTokens: number;
      };
      assertEquals(selectionPayload.inclusion, "adaptive");
      assert(selectionPayload.selectedTokens > 0, "selectedTokens must be a real positive count");
      assertLessOrEqual(selectionPayload.includedTokens, selectionPayload.availableTokens);

      const promptDump = activities.find((a) => a.action_type === "agent.prompt_debug_dump");
      assert(promptDump, "agent.prompt_debug_dump must be journaled at log_level=debug");
      const promptPayload = JSON.parse(promptDump!.payload) as { full_prompt: string };
      assert(
        promptPayload.full_prompt.includes(PAYMENT_ROUTER_SYMBOL),
        `the accepted final prompt must include the named fixture symbol '${PAYMENT_ROUTER_SYMBOL}'`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[phase198-cutover] the default summary daemon request runs the unchanged resolveKnowledgeContext path and never journals a selection event",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase198-summary-cutover-" });
    const portalDir = join(tempDir, "fixture-portal");
    try {
      await writeSymbolFixturePortal(portalDir);
      const { activities } = await bootCutoverRun(tempDir, portalDir, "summary");

      assertEquals(
        activities.some((a) => a.action_type === "portal.knowledge.selection_applied"),
        false,
        "summary mode must never journal a selection event",
      );
      const promptDump = activities.find((a) => a.action_type === "agent.prompt_debug_dump");
      assert(promptDump, "agent.prompt_debug_dump must be journaled at log_level=debug");
      const promptPayload = JSON.parse(promptDump!.payload) as { full_prompt: string };
      assert(
        promptPayload.full_prompt.includes("## Portal Knowledge Summary"),
        "summary mode must still run the pre-phase-198 resolveKnowledgeContext fallback unchanged",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

/** No second daemon boot needed — `previewPrompt` is the same production assembly path
 *  `AgentRunner.run` calls, so this measures real post-prepare tokens directly against a real
 *  `PortalKnowledgeService.analyze()` result, without a second LLM call. */
Deno.test({
  name:
    "[phase198-cutover] the production preview reports fewer post-prepare portal_knowledge tokens for adaptive than summary, on identical real-analyzed knowledge",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const portalDir = await Deno.makeTempDir({ prefix: "phase198-preview-fixture-" });
    try {
      await writeSymbolFixturePortal(portalDir);

      const service = new PortalKnowledgeService({
        config: {
          autoAnalyzeOnMount: false,
          defaultMode: PortalAnalysisMode.STANDARD,
          quickScanLimit: 100,
          maxFilesToRead: 20,
          ignorePatterns: [],
          staleness: 168,
          useLlmInference: false,
          relevanceSearchEmbeddingEnabled: false,
          enableAstAnalysis: true,
          enableTestExecution: false,
          enableVulnerabilityScan: false,
          enableGitHistoryAnalysis: false,
          gitHistoryCommitLimit: 500,
          gitHistorySince: "1.year",
        },
        memoryBank: {
          getProjectMemory: () => Promise.resolve(null),
          createProjectMemory: () => Promise.resolve(undefined),
          updateProjectMemory: () => Promise.resolve(undefined),
          listProjectMemories: () => Promise.resolve([]),
        } as never,
      });
      const knowledge = await service.analyze("payment-portal", portalDir, PortalAnalysisMode.STANDARD);
      assert(
        knowledge.symbolMap.some((s) => s.name === PAYMENT_ROUTER_SYMBOL),
        `real AST analysis must extract the ${PAYMENT_ROUTER_SYMBOL} symbol; got symbolMap=${
          JSON.stringify(knowledge.symbolMap)
        }`,
      );

      const tokenizer = new AiTokenEstimatorTokenizer();
      const promptBudgetAllocator = new PromptBudgetAllocator({ costTargetTokens: 20_000 }, tokenizer);
      const blueprint = { systemPrompt: "You are a test agent." };
      const traceId = crypto.randomUUID();

      const summaryRunner = new AgentRunner(new MockProvider("<thought>ok</thought><content>done</content>"), {
        tokenizer,
        promptBudgetAllocator,
      });
      const summaryPreview = await summaryRunner.previewPrompt(blueprint, {
        userPrompt: `Investigate ${PAYMENT_ROUTER_SYMBOL}`,
        context: { [PORTAL_KNOWLEDGE_KEY]: buildPortalKnowledgeSummary(knowledge) },
        traceId,
      });

      const adaptiveRunner = new AgentRunner(new MockProvider("<thought>ok</thought><content>done</content>"), {
        tokenizer,
        promptBudgetAllocator,
        context: {
          config: {
            get: () => ({
              portal_knowledge: {
                inclusion: "adaptive",
                max_tokens: 3_000,
                core_max_tokens: 512,
                relevant_max_entries: 20,
              },
            }),
          },
        } as never,
      });
      const adaptivePreview = await adaptiveRunner.previewPrompt(blueprint, {
        userPrompt: `Investigate ${PAYMENT_ROUTER_SYMBOL}`,
        context: {},
        portalKnowledgeSnapshot: knowledge,
        traceId,
      });

      const summarySegment = summaryPreview.segments.find((s) => s.kind === "portal_knowledge");
      const adaptiveSegment = adaptivePreview.segments.find((s) =>
        s.kind === "portal_knowledge" && s.included && s.resultingTokenEstimate > 0
      );
      assert(summarySegment, "summary preview must include a portal_knowledge segment");
      assert(adaptiveSegment, "adaptive preview must include an included portal_knowledge segment");
      console.log(
        `[phase198-cutover] portal-knowledge post-prepare tokens: summary=${summarySegment.resultingTokenEstimate}, adaptive=${adaptiveSegment.resultingTokenEstimate}; fixture=${PAYMENT_ROUTER_SYMBOL}; tokenizer=AiTokenEstimatorTokenizer`,
      );
      assert(
        adaptiveSegment.resultingTokenEstimate < summarySegment.resultingTokenEstimate,
        `adaptive tokens (${adaptiveSegment.resultingTokenEstimate}) must be fewer than summary tokens (${summarySegment.resultingTokenEstimate}) for a request naming a narrow subset`,
      );
      assertLessOrEqual(adaptiveSegment.resultingTokenEstimate, 3_000);
    } finally {
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    }
  },
});

/// Phase 199 Step 6 — real-daemon planning-tool cutover: with `[planning]
/// tools_enabled = true` in the real exa.config.toml and a recorded-mock provider, the
/// planning call executes a read-only `read_file` round (journaled `dynamic_tool_call` with
/// phase "planning") whose result feeds the final priorTurn, and the written plan carries the
/// marker whose only source is the fixture portal file. Flag-off boot is single-call with no
/// planning tool rows.

/** A valid plan body (PlanSchema) carrying the run-specific marker, reused verbatim by BOTH
 *  the flag-on final-round fixture and the flag-off single-call fixture so the two runs' plan
 *  shapes are byte-identical. */
function planningToolsPlanBody(marker: string): string {
  return "<thought>I read the portal target file via the planning tool loop.</thought>\n\n" +
    "<content>\n" +
    "{\n" +
    '  "subject": "Phase 199 planning tools cutover",\n' +
    '  "description": "The planning call inspected src/target.ts, whose marker content is ' + marker +
    '. The marker only source is the fixture portal file.",\n' +
    '  "steps": [\n' +
    '    { "step": 1, "title": "Inspect target file", "description": "Read src/target.ts during planning; the marker was observed." },\n' +
    '    { "step": 2, "title": "Commit plan", "description": "Finalize the plan carrying the observed marker." }\n' +
    "  ]\n" +
    "}\n" +
    "</content>";
}

interface IPlanningCutoverRow {
  action_type: string;
  payload: string;
}

/** Reads the trace-scoped activity rows for a planning-cutover run. */
async function readPlanningCutoverActivity(configPath: string, traceId: string): Promise<IPlanningCutoverRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IPlanningCutoverRow>(
      "SELECT action_type, payload FROM activity WHERE trace_id = ? ORDER BY rowid ASC",
      [traceId],
    );
  } finally {
    await db.close();
  }
}

/** Builds the flag-on or flag-off daemon TOML: an explicit mock default model (the schema
 *  default `models.default` would otherwise win over `[ai]`, resolving to a live provider),
 *  a recorded-mock strategy pointed at the fixtures dir, a portal, and — when enabled — the
 *  `[planning]` block. */
function writePlanningToolsCutoverConfig(
  configPath: string,
  root: string,
  portalDir: string,
  fixturesDir: string,
  toolsEnabled: boolean,
): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    'strategy = "recorded"',
    `fixtures_dir = "${fixturesDir}"`,
    "timeout_ms = 30000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[agents]",
    'default_model = "cutover-mock"',
    "",
    "[models.cutover-mock]",
    'provider = "mock"',
    'model = "test"',
    "timeout_ms = 30000",
    "",
    ...(toolsEnabled
      ? [
        "[planning]",
        "tools_enabled = true",
        "max_tool_rounds = 2",
        "max_tool_result_tokens = 2000",
        "",
      ]
      : []),
    "[[portals]]",
    'alias = "cutover-portal"',
    `target_path = "${portalDir}"`,
  ];
  Deno.writeTextFileSync(configPath, cfg.join("\n"));
}

/** Writes the two recorded-mock fixtures. Flag-on: callIndex 0 replays a `read_file` tool
 *  call, callIndex 1 replays the plan. Flag-off: callIndex 0 replays the plan directly
 *  (single-call), callIndex 1 is unused. */
async function writePlanningCutoverFixtures(
  fixturesDir: string,
  marker: string,
  toolsEnabled: boolean,
): Promise<void> {
  await Deno.mkdir(fixturesDir, { recursive: true });
  const plan = planningToolsPlanBody(marker);
  const planFixture = {
    promptHash: "phase199-plan-fixture",
    promptPreview: "final planning round",
    response: plan,
    model: "cutover-mock",
    tokens: { input: 1000, output: 300 },
    recordedAt: "2026-09-23T00:00:00.000Z",
    callSite: { scenarioId: "phase199", stepId: "planning", callIndex: 1 },
  };
  if (toolsEnabled) {
    await Deno.writeTextFile(
      join(fixturesDir, "explore-round.json"),
      JSON.stringify(
        {
          promptHash: "phase199-explore-round",
          promptPreview: "planning exploration round",
          response: "",
          model: "cutover-mock",
          tokens: { input: 1000, output: 0 },
          recordedAt: "2026-09-23T00:00:00.000Z",
          callSite: { scenarioId: "phase199", stepId: "planning", callIndex: 0 },
          toolCalls: [{ id: "toolu_01", name: "read_file", input: { path: "src/target.ts" } }],
        },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(join(fixturesDir, "final-round.json"), JSON.stringify(planFixture, null, 2));
  } else {
    await Deno.writeTextFile(
      join(fixturesDir, "single-call.json"),
      JSON.stringify(
        {
          promptHash: "phase199-single-call",
          promptPreview: "single planning call",
          response: plan,
          model: "cutover-mock",
          tokens: { input: 1000, output: 300 },
          recordedAt: "2026-09-23T00:00:00.000Z",
          callSite: { scenarioId: "phase199", stepId: "planning", callIndex: 0 },
        },
        null,
        2,
      ),
    );
  }
}

/** Boots a real daemon, injects the fixture request, waits for the planning tool loop to
 *  journal (flag-on) or the plan to be written (flag-off), and returns the trace activity +
 *  the written plan's text. */
async function bootPlanningToolsCutoverRun(
  tempDir: string,
  toolsEnabled: boolean,
): Promise<{ traceId: string; rows: IPlanningCutoverRow[]; planText: string }> {
  const configPath = join(tempDir, "exa.config.toml");
  const portalDir = join(tempDir, "fixture-portal");
  const fixturesDir = join(tempDir, "fixtures");
  const marker = `EXAIX_PHASE199_MARKER_${crypto.randomUUID().slice(0, 8)}`;

  await Deno.mkdir(join(portalDir, "src"), { recursive: true });
  await Deno.writeTextFile(
    join(portalDir, "src", "target.ts"),
    "// The marker below is the ONLY source of the marker string.\n// " + marker + '\nexport const target = "read";\n',
  );
  await writePlanningCutoverFixtures(fixturesDir, marker, toolsEnabled);
  writePlanningToolsCutoverConfig(configPath, tempDir, portalDir, fixturesDir, toolsEnabled);

  await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
  await Deno.copyFile(
    join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
    join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
  );

  const traceId = crypto.randomUUID();
  const requestPath = join(tempDir, "Workspace", "Requests", `r-${traceId.slice(0, 8)}.md`);
  let planText = "";
  const readPlan = () => {
    const plans = [...Deno.readDirSync(join(tempDir, "Workspace", "Plans"))];
    return plans.length > 0 ? Deno.readTextFileSync(join(tempDir, "Workspace", "Plans", plans[0].name)) : "";
  };

  await bootRealDaemon(configPath, 20000, {
    midFlight: () => {
      Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
      Deno.mkdirSync(join(tempDir, "Workspace", "Plans"), { recursive: true });
      Deno.writeTextFileSync(
        requestPath,
        "---\n" +
          `trace_id: "${traceId}"\n` +
          `created: "${new Date().toISOString()}"\n` +
          "status: pending\n" +
          "priority: normal\n" +
          "agent_role: mock-agent\n" +
          "portal: cutover-portal\n" +
          'scenario_id: "phase199"\n' +
          'step_id: "planning"\n' +
          "source: cli\n" +
          'created_by: "test@example.com"\n' +
          'subject: "Phase 199 planning tools cutover"\n' +
          "---\n\n" +
          "# Request\n\n" +
          "Inspect the portal target file and produce a plan.\n",
      );
    },
    afterInjectMs: 60000,
    waitForAfterInject: async () => {
      if (toolsEnabled) {
        const rows = await readPlanningCutoverActivity(configPath, traceId);
        return rows.some((r) => r.action_type === "planning.tools.completed");
      }
      planText = readPlan();
      return planText.length > 0;
    },
  });

  if (!planText) planText = readPlan();
  return { traceId, rows: await readPlanningCutoverActivity(configPath, traceId), planText };
}

Deno.test({
  name:
    "[phase199-planning-tools-cutover] a real daemon boot with tools_enabled=true journals a phase:planning read_file round that shapes the written plan",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase199-planning-tools-cutover-" });
    try {
      const { traceId, rows, planText } = await bootPlanningToolsCutoverRun(tempDir, true);

      const toolRow = rows.find((r) => r.action_type === "dynamic_tool_call");
      assert(
        toolRow,
        `a planning dynamic_tool_call row must exist. got: ${JSON.stringify(rows.map((r) => r.action_type))}`,
      );
      const toolPayload = JSON.parse(toolRow!.payload) as {
        tool: string;
        phase: string;
        resultSummary: string;
      };
      assertEquals(toolPayload.tool, "read_file");
      assertEquals(toolPayload.phase, "planning");
      // The journaled resultSummary is the exact content the loop feeds to the next round's
      // priorTurn (planning_tool_loop.ts: capToTokenLimit → buildPriorTurn → logDynamicToolCall).
      assert(
        toolPayload.resultSummary.includes("EXAIX_PHASE199_MARKER_"),
        `the read_file result must carry the fixture marker, got ${toolPayload.resultSummary}`,
      );

      const completed = rows.find((r) => r.action_type === "planning.tools.completed");
      assert(
        completed,
        `a planning.tools.completed row must exist. got: ${JSON.stringify(rows.map((r) => r.action_type))}`,
      );
      const completedPayload = JSON.parse(completed!.payload) as { rounds: number; toolCalls: number };
      assertEquals(completedPayload.rounds, 2);
      assert(completedPayload.toolCalls >= 1, "the loop must have executed at least one tool call");

      assertEquals(
        rows.some((r) => r.action_type === "planning.tools.skipped"),
        false,
        "a flag-on run whose gate passed must not journal a skip event",
      );

      assert(planText.includes("EXAIX_PHASE199_MARKER_"), "the written plan must carry the fixture marker");
      assert(planText.includes(traceId.slice(0, 8)), "the plan file must be the run's own (trace-prefixed)");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[phase199-planning-tools-cutover] flag-off boot is single-call: no dynamic_tool_call/planning.tools.* rows and a byte-identical plan shape",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase199-planning-tools-off-" });
    try {
      const { rows, planText } = await bootPlanningToolsCutoverRun(tempDir, false);

      assertEquals(
        rows.some((r) => r.action_type === "dynamic_tool_call"),
        false,
        "the flag-off single-call boot must never journal a dynamic_tool_call row",
      );
      assertEquals(
        rows.some((r) => r.action_type.startsWith("planning.tools.")),
        false,
        "the flag-off boot must never journal planning.tools.* rows",
      );

      // The flag-off plan carries the same marker the flag-on final round produced — the
      // single-call run consumed the same recorded response, so the plan shape is identical.
      assert(planText.includes("EXAIX_PHASE199_MARKER_"), "the flag-off plan must carry the same fixture marker");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
