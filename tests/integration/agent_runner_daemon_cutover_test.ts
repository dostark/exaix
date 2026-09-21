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
import { ConfigService } from "@exaix/core/config";
import { EventLogger } from "@exaix/core/logger";
import { AgentComposer } from "@exaix/execution";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { PromptBudgetAllocator } from "@exaix/core";
import { PortalContextBuilder } from "@exaix/request";
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

/** Phase 196 Step 9 — real daemon boot proves cost-ceiling enforcement for the planning call.
 *  Boots a real daemon twice against the same real request + portal fixture: once with
 *  `budget.cost_target_tokens_per_request` set so the portalKnowledge section budget exactly
 *  equals the injected file-listing tokens (forcing the knowledge-summary portal segment to be
 *  DROPPED — `droppedSegmentCount > 0`), once with the ceiling unset (`droppedSegmentCount === 0`,
 *  today's behavior). The exact-fit (costTarget, file-count) pair is found at runtime against the
 *  actual fixture (the section budget is a step function of T ≈ listingTokens/0.2475 under the
 *  allocator's base weights, so a small file-count sweep guarantees a pair whose per-line boundary
 *  lands exactly on a reachable budget), making the drop deterministic rather than a token-guess. */

const EXACT_FIT_PORTAL_FILE_COUNT = 140;

function writeDaemonConfigWithPortalAndCeiling(
  configPath: string,
  root: string,
  portalDir: string,
  costTarget: number | null,
): void {
  const budgetLine = costTarget !== null ? `[budget_enforcement]\ncostTargetTokens = ${costTarget}\n\n` : "";
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
    budgetLine,
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Counts the file-listing `portal_context` block tokens exactly the way the daemon's
 *  `PortalContextBuilder.buildFileContext` will at request time, so the exact-fit ceiling can be
 *  computed deterministically. */
async function countPortalContextTokens(portalDir: string): Promise<number> {
  const tokenizer = new AiTokenEstimatorTokenizer();
  const builder = new PortalContextBuilder({
    config: { portals: [{ alias: "cutover-portal", target_path: portalDir }] } as never,
  });
  const block = (await builder.buildFileContext("cutover-portal")) ?? "";
  return tokenizer.countTokens(block, "default");
}

/** Portal-knowledge section budget under `costTargetTokens`, via the real allocator (base weights,
 *  no analysis hints — exactly what `assemblePromptSegments` passes). `allocate` rejects
 *  (`ContextBudgetExceededError`) when the ceiling is below the allocator's floor-derived section
 *  sum (~5042), so a sub-floor T returns -1 rather than throwing. */
async function portalKnowledgeBudgetFor(costTarget: number): Promise<number> {
  const allocator = new PromptBudgetAllocator({ costTargetTokens: costTarget });
  try {
    const budget = await allocator.allocate("default");
    return budget.sections.portalKnowledge;
  } catch {
    return -1;
  }
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

Deno.test({
  name:
    "[phase196-costcutover] a real daemon boot with budget.cost_target_tokens_per_request set tight DROPS the portal-knowledge section segment for the planning call, while the unset run keeps every segment",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    for (const scenarioLabel of ["constrained", "unconstrained"] as const) {
      const tempDir = await Deno.makeTempDir({ prefix: `step9-${scenarioLabel}-` });
      const portalDir = join(tempDir, "fixture-portal");
      // The exact-fit depends on the listing token count landing on a reachable allocator step;
      // the `Portal Root:` path length shifts the count per run, so find a file-count × costTarget
      // whose budget equals the listing for THIS dir (deterministic for the fixed tokenizer).
      let nFiles = EXACT_FIT_PORTAL_FILE_COUNT;
      let exactFitT: number | undefined;
      if (scenarioLabel === "constrained") {
        await Deno.mkdir(join(portalDir, "src"), { recursive: true });
        for (let attempt = 0; attempt < 40 && exactFitT === undefined; attempt++) {
          for await (const f of Deno.readDir(join(portalDir, "src"))) {
            await Deno.remove(join(portalDir, "src", f.name)).catch(() => {});
          }
          for (let i = 0; i < nFiles; i++) {
            await Deno.writeTextFile(
              join(portalDir, "src", `${String(i).padStart(4, "0")}-module-file.ts`),
              "// fixture\n",
            );
          }
          const listingTokens = await countPortalContextTokens(portalDir);
          // `portalKnowledgeBudgetFor` is monotone non-decreasing in T above the allocator's
          // floor (~5042); scan the full safe band so the exact fit is found for the current dir.
          for (let t = 5_100; t <= 12_000; t++) {
            if (await portalKnowledgeBudgetFor(t) === listingTokens) {
              exactFitT = t;
              break;
            }
          }
          if (exactFitT === undefined) nFiles += 3;
        }
        assert(
          exactFitT !== undefined,
          "no (file-count × costTarget) exact-fit found for the portal fixture in the safe band",
        );
      } else {
        await Deno.mkdir(join(portalDir, "src"), { recursive: true });
        for (let i = 0; i < EXACT_FIT_PORTAL_FILE_COUNT; i++) {
          await Deno.writeTextFile(
            join(portalDir, "src", `${String(i).padStart(4, "0")}-module-file.ts`),
            "// fixture\n",
          );
        }
      }
      const configPath = join(tempDir, "exa.config.toml");
      writeDaemonConfigWithPortalAndCeiling(configPath, tempDir, portalDir, exactFitT ?? null);
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.copyFile(
        join(Deno.cwd(), "Blueprints", "Agents", "mock-agent.md"),
        join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
      );
      const { traceId, requestPath } = makePortalRequestAndBoot(tempDir);
      try {
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
        const events = await collectBudgetEvents(configPath);
        const consumed = events.find((e) => e.action_type === "context.budget.consumed");
        assert(consumed, `${scenarioLabel} run must journal context.budget.consumed for the planning call`);
        const dropped = Number(consumed.payload["droppedSegmentCount"]);
        const used = Number(consumed.payload["usedInputTokens"]);
        if (scenarioLabel === "constrained") {
          assert(
            dropped > 0,
            `constrained run (costTarget=${exactFitT}) must drop a planning-call segment, got droppedSegmentCount=${dropped}, usedInputTokens=${used}`,
          );
        } else {
          assert(
            dropped === 0,
            `unconstrained run must keep every segment (droppedSegmentCount=0), got ${dropped}`,
          );
        }
        console.log(
          `[phase196-costcutover] ${scenarioLabel}: costTarget=${
            exactFitT ?? null
          }, droppedSegmentCount=${dropped}, usedInputTokens=${used}`,
        );
      } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
      }
    }
  },
});
