/**
 * @module DogfoodE2ETest
 * @path tests/integration/dogfood_e2e_test.ts
 * @description E2E proof: daemon subprocess with mock provider → request file →
 * plan file. Exercises apps/daemon/main.ts with FileWatcher + RequestProcessor +
 * PlanWriter.
 */

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { migrateDaemonWorkspace } from "./helpers/daemon_config.ts";

function writeDaemonConfig(configPath: string, root: string): void {
  const cfg = [
    "[system]",
    'version = "1.0.0"',
    'log_level = "info"',
    `root = "${root}"`,
    "",
    "[paths]",
    'workspace = "./Workspace"',
    'blueprints = "./Blueprints"',
    'runtime = "./.exa"',
    'memory = "./Memory"',
    'portals = "./Portals"',
    'active = "Active"',
    'plans = "Plans"',
    'requests = "Requests"',
    "",
    "[watcher]",
    "debounce_ms = 100",
    "stability_check = false",
    "",
    "[database]",
    "batch_flush_ms = 100",
    "batch_max_size = 100",
    "",
    "[database.sqlite]",
    'journal_mode = "WAL"',
    "foreign_keys = true",
    "busy_timeout_ms = 5000",
    "",
    "[agents]",
    'default_model = "default"',
    "",
    "[models.default]",
    'provider = "mock"',
    'model = "gpt-5.2-pro"',
    "timeout_ms = 30000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[portal_knowledge]",
    "auto_analyze_on_mount = false",
    'default_mode = "quick"',
    "staleness_hours = 24",
    "use_llm_inference = false",
    "enable_ast_analysis = false",
    "enable_vulnerability_scan = false",
    "enable_git_history_analysis = false",
    "enable_test_execution = false",
    "relevance_search_embedding_enabled = false",
    "quick_scan_limit = 50",
    "max_files_to_read = 10",
    "max_pattern_detector_sample_size = 10",
    "min_pattern_detector_sample_size = 1",
    "git_history_commit_limit = 50",
    'ignore_patterns = ["node_modules", ".git"]',
    "",
    "[mcp]",
    "enabled = true",
    'transport = "stdio"',
    'server_name = "exaix"',
    'version = "1.0.0"',
    "",
    "[ai_retry]",
    "max_attempts = 3",
    "backoff_base_ms = 1000",
    "timeout_per_request_ms = 30000",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

Deno.test({
  name: "dogfood e2e: daemon → request → plan",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const env = await TestEnvironment.create();
    const tempDir = env.tempDir;

    try {
      const configPath = join(tempDir, "exa.config.toml");
      writeDaemonConfig(configPath, tempDir);

      await env.createBlueprint("senior-coder");
      await migrateDaemonWorkspace(tempDir);

      const proc = new Deno.Command("deno", {
        args: ["run", "--allow-all", "apps/daemon/main.ts"],
        stdin: "null",
        stdout: "null",
        stderr: "null",
        env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1" },
      }).spawn();

      const pid = proc.pid;
      assertExists(pid, "Daemon process should have a PID");

      try {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          Deno.kill(pid, 0);
        } catch {
          await proc.status;
          assert(false, "Daemon died during startup");
        }

        let planPath: string | undefined;
        let requestTraceId: string;

        await t.step("request → plan", async () => {
          const requestResult = await env.createRequest(
            "Add a health endpoint to src/api/health.ts returning { status: 'ok' }",
            { identityId: "senior-coder", priority: 5 },
          );
          requestTraceId = requestResult.traceId;

          // Poll Plans directory for any plan file containing the trace_id
          const found = await env.waitFor(
            async () => {
              try {
                Deno.kill(pid, 0);
              } catch {
                return true; // will assert below
              }
              const files = await env.listFiles("Workspace/Plans");
              for (const f of files) {
                if (f.endsWith("_plan.md")) {
                  const content = await env.readFile(`Workspace/Plans/${f}`);
                  if (content.includes(requestTraceId)) {
                    planPath = join(tempDir, "Workspace", "Plans", f);
                    return true;
                  }
                }
              }
              return false;
            },
            { timeout: 30_000, interval: 1_000 },
          );

          assert(found, "Plan should appear within 30s");
          assertExists(planPath);
        });

        await t.step("plan has expected sections", async () => {
          const content = await Deno.readTextFile(planPath!);
          assertStringIncludes(content, "## Reasoning");
          assertStringIncludes(content, "## Execution Steps");
        });

        // Journal assertion: the daemon writes events to the shared SQLite DB.
        // The daemon's DatabaseService uses the same journal.db as the test env.
        // Wait briefly for async batch flush, then verify at least two events.
        await t.step("journal contains daemon events", async () => {
          await new Promise((r) => setTimeout(r, 500));
          const activities = await env.getActivityLog(requestTraceId!);
          assert(activities.length >= 2, `Expected >=2 journal entries for trace, got ${activities.length}`);
        });
      } finally {
        try {
          Deno.kill(pid, "SIGTERM");
        } catch {
          // already dead
        }
        try {
          await proc.status;
        } catch {
          // already finished
        }
      }
    } finally {
      await env.cleanup();
    }
  },
});
