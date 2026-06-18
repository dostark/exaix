/**
 * @module DogfoodE2ETest
 * @path tests/integration/dogfood_e2e_test.ts
 * @description Minimal E2E proof: daemon subprocess with dogfood config (mock
 * provider) → request file → plan file. Exercises the production daemon entry
 * point at apps/daemon/main.ts with FileWatcher + RequestProcessor + PlanWriter.
 */

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";

function writeTomlConfig(root: string): string {
  const configPath = join(root, "exa.config.toml");
  Deno.writeTextFileSync(
    configPath,
    [
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
    ].join("\n"),
  );
  return configPath;
}

Deno.test({
  name: "dogfood e2e: daemon → request → plan",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    // Use TestEnvironment for setup, then write our own config and start daemon
    const env = await TestEnvironment.create();
    const tempDir = env.tempDir;

    try {
      const configPath = writeTomlConfig(tempDir);
      const requestsDir = join(tempDir, "Workspace", "Requests");
      const plansDir = join(tempDir, "Workspace", "Plans");

      // Create blueprint
      await env.createBlueprint("senior-coder");

      // Start daemon subprocess (stdin/out/err → null to avoid pipe blocking)
      const proc = new Deno.Command("deno", {
        args: ["run", "--allow-all", "apps/daemon/main.ts"],
        stdin: "null",
        stdout: "null",
        stderr: "null",
        env: {
          EXA_CONFIG_PATH: configPath,
          EXA_TEST_MODE: "1",
        },
      }).spawn();

      const pid = proc.pid;
      assertExists(pid, "Daemon process should have a PID");

      try {
        // Give daemon time to initialize and watchers to start
        await new Promise((r) => setTimeout(r, 3000));

        // Verify daemon still alive
        try {
          Deno.kill(pid, 0);
        } catch {
          await proc.status;
          assert(false, "Daemon died during startup");
        }

        // Write request file
        let planPath: string | undefined;
        const traceId = crypto.randomUUID();

        await t.step("request → plan", async () => {
          const requestContent = [
            "---",
            `trace_id: "${traceId}"`,
            `created: "${new Date().toISOString()}"`,
            "status: pending",
            "priority: 5",
            "identity: senior-coder",
            "source: e2e-test",
            "created_by: e2e-test",
            "---",
            'Add a health endpoint to src/api/health.ts returning { status: "ok" }',
          ].join("\n");

          Deno.writeTextFileSync(join(requestsDir, `${traceId}.md`), requestContent);

          // Poll for plan file (30s timeout)
          const deadline = Date.now() + 30_000;
          let found = false;
          while (Date.now() < deadline) {
            try {
              Deno.kill(pid, 0);
            } catch {
              await proc.status;
              assert(false, "Daemon died while polling");
            }

            const entries: string[] = [];
            for await (const entry of Deno.readDir(plansDir)) {
              entries.push(entry.name);
            }
            const match = entries.find(
              (name) => name.includes(traceId) && name.endsWith("_plan.md"),
            );
            if (match) {
              planPath = join(plansDir, match);
              found = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }

          assert(found, "Plan file should appear within 30s timeout");
          assertExists(planPath);
        });

        // Verify plan content
        await t.step("plan has expected sections", async () => {
          const content = await Deno.readTextFile(planPath!);
          assertStringIncludes(content, traceId);
          assertStringIncludes(content, "## Reasoning");
          assertStringIncludes(content, "## Execution Steps");
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
