/**
 * @module PlanExecutionDetectionIntegrationTest
 * @path tests/integration/plan_execution_detection_test.ts
 * @description A real daemon watches Workspace/Active. An approved plan is detected with the content
 *   the watcher read. Other markdown is ignored. A malformed plan is reported as failed, and the
 *   watcher still detects the next plan.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/fs, @std/path, @db/sqlite, @exaix/core/events, ./helpers/daemon_config.ts]
 * @related-files [apps/daemon/main.ts, apps/daemon/src/watcher.ts, packages/execution/src/execution_loop.ts]
 */

import { DEFAULT_ACTIVE_PATH, DEFAULT_RUNTIME_PATH, DEFAULT_WORKSPACE_PATH } from "@exaix/shared";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { Database } from "@db/sqlite";
import { DomainEventType } from "@exaix/core/events";
import { bootRealDaemon, type IRunningDaemon, writeDaemonConfigWithMockAi } from "./helpers/daemon_config.ts";

/** Terminal rows the watcher handler journals after `ExecutionLoop.processTask` returns. */
const EXECUTION_MANAGED_EVENT = "plan.execution_managed";
const EXECUTION_MANAGED_FAILURE_EVENT = "plan.execution_managed_failure";
const TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface IPlanWorkspace {
  root: string;
  configPath: string;
  activeDir: string;
}

interface IJournalRow {
  payload: string;
  trace_id: string | null;
}

async function createPlanWorkspace(): Promise<IPlanWorkspace> {
  const root = await Deno.makeTempDir({ prefix: "plan-detection-" });
  const configPath = join(root, "exa.config.toml");
  writeDaemonConfigWithMockAi(configPath, root);
  const activeDir = join(root, DEFAULT_WORKSPACE_PATH, DEFAULT_ACTIVE_PATH);
  await ensureDir(activeDir);
  return { root, configPath, activeDir };
}

/** Journal rows for one action that name `path` as their target or inside their payload. */
function journalRowsNaming(configPath: string, action: string, path: string): IJournalRow[] {
  const db = new Database(join(dirname(configPath), DEFAULT_RUNTIME_PATH, "journal.db"), { readonly: true });
  try {
    return db.prepare(
      "SELECT payload, trace_id FROM activity WHERE action_type = ? AND (target = ? OR instr(payload, ?) > 0) ORDER BY rowid",
    ).all<IJournalRow>(action, path, path);
  } finally {
    db.close();
  }
}

function journaled(configPath: string, action: string, path: string): boolean {
  return journalRowsNaming(configPath, action, path).length > 0;
}

/** True once the watcher handler has reported on this plan, as a success or as a failure. */
function reported(configPath: string, path: string): boolean {
  return journaled(configPath, EXECUTION_MANAGED_EVENT, path) ||
    journaled(configPath, EXECUTION_MANAGED_FAILURE_EVENT, path);
}

/** Frontmatter and body for a plan file. Only the frontmatter differs between the cases. */
function planDocument(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\n# Plan\n\n## Proposed Plan\n\n### Overview\nImplement a hello world function in utils.ts.\n`;
}

Deno.test({
  name:
    "[plan_detection] an approved plan is detected with the content the watcher read, and other markdown is ignored",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspace = await createPlanWorkspace();
    try {
      const traceId = crypto.randomUUID();
      const requestId = `request-${traceId.slice(0, 8)}`;
      const readme = join(workspace.activeDir, "README.md");
      const nearMiss = join(workspace.activeDir, "request-notes_planning.md");
      const planPath = join(workspace.activeDir, `${requestId}_plan.md`);
      const content = planDocument(
        [
          `trace_id: "${traceId}"`,
          `request_id: "${requestId}"`,
          'agent_role: "senior-coder"',
          "status: approved",
          `created_at: "${new Date().toISOString()}"`,
        ].join("\n"),
      );

      await bootRealDaemon(workspace.configPath, {
        midFlight: async (daemon: IRunningDaemon) => {
          await Deno.writeTextFile(readme, "# Active tasks\n");
          await Deno.writeTextFile(nearMiss, "# Planning notes\n");
          await daemon.until(
            () => journaled(workspace.configPath, DomainEventType.WatcherFileReady, readme),
            "the watcher to read README.md",
          );
          await daemon.until(
            () => journaled(workspace.configPath, DomainEventType.WatcherFileReady, nearMiss),
            "the watcher to read a near-miss file name",
          );

          await Deno.writeTextFile(planPath, content);
          await daemon.until(
            () => journaled(workspace.configPath, DomainEventType.PlanDetected, planPath),
            "the approved plan to be detected",
          );

          // Rows flush in queue order. A detection of a non-plan file was queued before the plan's.
          assertEquals(journalRowsNaming(workspace.configPath, DomainEventType.PlanDetected, readme), []);
          assertEquals(journalRowsNaming(workspace.configPath, DomainEventType.PlanDetected, nearMiss), []);
        },
      });

      const [detected] = journalRowsNaming(workspace.configPath, DomainEventType.PlanDetected, planPath);
      assertExists(detected);
      assertEquals(
        JSON.parse(detected.payload).size,
        content.length,
        "the handler received the content the watcher read",
      );
    } finally {
      await Deno.remove(workspace.root, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[plan_detection] a malformed plan is reported as failed and the watcher still detects the next plan",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspace = await createPlanWorkspace();
    try {
      const broken = join(workspace.activeDir, "broken_plan.md");
      const traceless = join(workspace.activeDir, "traceless_plan.md");
      const next = join(workspace.activeDir, "next_plan.md");

      await bootRealDaemon(workspace.configPath, {
        midFlight: async (daemon: IRunningDaemon) => {
          await Deno.writeTextFile(broken, planDocument("trace_id: [broken yaml\nstatus: approved"));
          await daemon.until(() => reported(workspace.configPath, broken), "the broken plan to be reported");
          assertEquals(journaled(workspace.configPath, EXECUTION_MANAGED_EVENT, broken), false);
          assertEquals(journaled(workspace.configPath, EXECUTION_MANAGED_FAILURE_EVENT, broken), true);
          // The parse fails before a lease is taken, so execution never starts for this plan.
          assertEquals(journaled(workspace.configPath, DomainEventType.ExecutionStarted, broken), false);

          // A missing trace_id is not rejected. The schema generates one, and execution starts under it.
          await Deno.writeTextFile(traceless, planDocument("status: approved"));
          await daemon.until(() => reported(workspace.configPath, traceless), "the traceless plan to be reported");
          const started = journalRowsNaming(workspace.configPath, DomainEventType.ExecutionStarted, traceless)[0];
          assertExists(started, "a traceless plan that parses must start execution");
          assert(TRACE_ID_PATTERN.test(started.trace_id ?? ""), "the generated trace id is a UUID");

          // The failures above must not stop the watcher from detecting a later plan.
          await Deno.writeTextFile(next, planDocument(`trace_id: "${crypto.randomUUID()}"\nstatus: approved`));
          await daemon.until(
            () => journaled(workspace.configPath, DomainEventType.PlanDetected, next),
            "the watcher to detect a plan after the failures",
          );
        },
      });
    } finally {
      await Deno.remove(workspace.root, { recursive: true }).catch(() => {});
    }
  },
});
