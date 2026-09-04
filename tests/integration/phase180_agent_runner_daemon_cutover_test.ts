/**
 * @module Phase180AgentRunnerDaemonCutoverTest
 * @path tests/integration/phase180_agent_runner_daemon_cutover_test.ts
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
 * @architectural-layer Integration
 * @related-files [apps/daemon/main.ts, packages/request/src/processor.ts, packages/request/src/router.ts, packages/execution/src/agent_composer.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { EventLogger } from "@exaix/core/logger";
import { AgentComposer } from "@exaix/execution";
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
}

async function readActivity(configPath: string): Promise<IActivityRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, runner_kind, trace_id FROM activity ORDER BY rowid ASC",
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
        afterInjectMs: 4000,
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
