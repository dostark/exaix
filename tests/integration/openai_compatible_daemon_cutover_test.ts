/**
 * @module OpenAiCompatibleDaemonCutoverTest
 * @path tests/integration/openai_compatible_daemon_cutover_test.ts
 * @description Proves a real daemon selects the configured compatible provider and replays a permitted ReAct tool call.
 * @architectural-layer Integration
 * @related-files [apps/daemon/main.ts, packages/ai-openai/src/compatible_factory.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import { setupGitRepo } from "@exaix/git/testing";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
  cost_usd: number | null;
}

interface IFixtureRequestBody {
  model?: string;
  tool_choice?: string;
  tools?: Array<{ type: string }>;
  messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
}

interface IObservedFixtureRequest {
  body: IFixtureRequestBody;
  authorization: string | null;
}

async function readTraceActivity(configPath: string, traceId: string): Promise<IActivityRow[]> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, trace_id, payload, cost_usd FROM activity WHERE trace_id = ? ORDER BY rowid ASC",
      [traceId],
    );
  } finally {
    await db.close();
  }
}

for (const mode of ["enabled", "disabled", "unlimited", "invalid-config", "unauthorized-write", "traversal"] as const) {
  const nativeToolsEnabled = mode !== "disabled";
  Deno.test({
    name: `[phase155] real daemon compatible cutover mode=${mode}`,
    ignore: Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const root = await Deno.makeTempDir({ prefix: "phase155-compatible-daemon-" });
      const portal = join(root, "portal");
      const configPath = join(root, "exa.config.toml");
      const fixtureMarker = `PHASE155_FIXTURE_${crypto.randomUUID().slice(0, 8)}`;
      const outsideMarker = `OUTSIDE_${crypto.randomUUID()}`;
      let requestCount = 0;
      const observedRequests: IObservedFixtureRequest[] = [];
      const fixture = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
        if (new URL(request.url).pathname === "/api/embed") {
          const embeddingRequest = await request.json() as { input?: string[] };
          return Response.json({ embeddings: (embeddingRequest.input ?? []).map(() => Array(768).fill(0)) });
        }
        requestCount++;
        const body = await request.json() as IFixtureRequestBody;
        observedRequests.push({ body, authorization: request.headers.get("authorization") });
        const messages = body.messages ?? [];
        if (requestCount === 1) {
          const plan = "<thought>Read the requested portal file during execution.</thought>\n\n" +
            "<content>\n" +
            JSON.stringify({
              subject: "Phase 155 local provider cutover",
              description: `Read src/marker.txt and return ${fixtureMarker}.`,
              steps: [{
                step: 1,
                title: "Read the marker",
                description: "Read src/marker.txt through the permitted tool.",
              }],
            }) +
            "\n</content>";
          return Response.json({
            model: "compat-fixture-v1",
            choices: [{
              message: {
                role: "assistant",
                content: plan,
              },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
          });
        }
        if (requestCount === 2 && nativeToolsEnabled) {
          return Response.json({
            model: "compat-fixture-v1",
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "phase155-call-1",
                  type: "function",
                  function: mode === "unauthorized-write"
                    ? { name: "write_file", arguments: '{"path":"src/marker.txt","content":"unauthorized"}' }
                    : {
                      name: "read_file",
                      arguments: mode === "traversal"
                        ? '{"path":"../outside-marker.txt"}'
                        : '{"path":"src/marker.txt"}',
                    },
                }],
              },
              finish_reason: "tool_calls",
            }],
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          });
        }
        const toolMessage = messages.find((message) => message.role === "tool");
        const isReport = messages[0]?.content?.includes("### EXECUTION REPORT SUMMARY ###");
        if (
          nativeToolsEnabled && !isReport &&
          (!toolMessage || toolMessage.tool_call_id !== "phase155-call-1" || body.tool_choice !== "auto")
        ) {
          return Response.json({ error: { type: "invalid_request_error", message: "Invalid native replay" } }, {
            status: 400,
          });
        }
        return Response.json({
          model: "compat-fixture-v1",
          choices: [{
            message: {
              role: "assistant",
              content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}${fixtureMarker}`,
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 55, completion_tokens: 8, total_tokens: 63 },
        });
      });
      const port = (fixture.addr as Deno.NetAddr).port;
      try {
        await Deno.mkdir(join(portal, "src"), { recursive: true });
        await Deno.writeTextFile(join(portal, "src", "marker.txt"), fixtureMarker);
        await Deno.writeTextFile(join(root, "outside-marker.txt"), outsideMarker);
        await setupGitRepo(portal, { initialCommit: true });
        for (const args of [["add", "src/marker.txt"], ["commit", "-m", "Add fixture marker"]]) {
          const git = await new Deno.Command("git", { args, cwd: portal, stdout: "piped", stderr: "piped" }).output();
          assertEquals(git.code, 0, new TextDecoder().decode(git.stderr));
        }
        const config = [
          ...daemonConfigSections(root, ""),
          "",
          "[ai]",
          'provider = "mock"',
          'model = "test"',
          "",
          "[ai.mock]",
          "timeout_ms = 30000",
          "",
          "[agents]",
          'default_model = "compat-agent"',
          "",
          "[models.compat-agent]",
          'provider = "openai-chat"',
          'model = "compat-fixture-v1"',
          "timeout_ms = 10000",
          "",
          "[models.compat-agent.compatible]",
          'profile = "local-test"',
          `endpoint = "http://127.0.0.1:${port}/v1/chat/completions"`,
          'model = "compat-fixture-v1"',
          "allow_insecure_loopback = true",
          "",
          "[quality_gate]",
          "enabled = false",
          "",
          "[execution]",
          `native_tools_enabled = ${nativeToolsEnabled}`,
          "",
          "[rate_limiting]",
          `enabled = ${mode !== "unlimited"}`,
          "",
          "[memory.embedding]",
          'provider = "ollama"',
          'model = "nomic-embed-text"',
          `baseUrl = "http://127.0.0.1:${port}"`,
          "",
          "[[portals]]",
          'alias = "phase155-portal"',
          `target_path = "${portal}"`,
        ].join("\n");
        const rejectionConfig = mode === "invalid-config"
          ? `\n[models.mock]\nprovider = "openai-chat"\nmodel = "compat-fixture-v1"\n[models.mock.compatible]\nprofile = "local-test"\nendpoint = "http://example.invalid/v1/chat/completions"\nallow_insecure_loopback = true\n`
          : "";
        await Deno.writeTextFile(configPath, config + rejectionConfig);
        await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
        await Deno.writeTextFile(
          join(root, "Blueprints", "Agents", "compat-agent.md"),
          [
            "---",
            'agent_role: "compat-agent"',
            'name: "Compatible ReAct Agent"',
            'model: "openai-chat:compat-fixture-v1"',
            "model_size: M",
            "characteristics: [fastest]",
            'capabilities: ["react"]',
            'created: "2026-09-27T00:00:00Z"',
            'created_by: "phase155-test"',
            'version: "1.0.0"',
            'description: "Local compatible provider cutover fixture"',
            "default_skills: []",
            'permitted_tools: ["read_file"]',
            "---",
            "Read the requested file and return the result.",
            "",
          ].join("\n"),
        );

        const traceId = crypto.randomUUID();
        const requestPath = join(root, "Workspace", "Requests", `r-${traceId.slice(0, 8)}.md`);
        await bootRealDaemon(configPath, 2000, {
          extraEnv: { EXA_COMPAT_TEST_API_KEY: "local-fixture-key" },
          denoPermissions: [
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-run",
            "--allow-sys",
            "--allow-ffi",
            "--allow-net=127.0.0.1",
          ],
          midFlight: async () => {
            await Deno.mkdir(join(root, "Workspace", "Requests"), { recursive: true });
            await Deno.writeTextFile(
              requestPath,
              `---\ntrace_id: "${traceId}"\ncreated: "${new Date().toISOString()}"\n` +
                "status: pending\npriority: normal\nagent_role: compat-agent\nportal: phase155-portal\n" +
                'source: cli\ncreated_by: "test@example.com"\nsubject: "Phase 155 local provider cutover"\n---\n\n' +
                "# Request\n\nRead src/marker.txt through the permitted tool.\n",
            );
            if (mode === "invalid-config") return;
            const plansDir = join(root, "Workspace", "Plans");
            const deadline = Date.now() + 20000;
            let planId: string | undefined;
            while (Date.now() < deadline) {
              try {
                const plan = [...Deno.readDirSync(plansDir)].find((entry) =>
                  entry.isFile && entry.name.endsWith(".md")
                );
                if (plan) {
                  planId = plan.name.slice(0, -3);
                  break;
                }
              } catch {
                // The daemon creates the plans directory after it receives the request.
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert(
              planId,
              `daemon must write a review plan before approval: ${JSON.stringify(observedRequests)}`,
            );
            const approval = await new Deno.Command("deno", {
              args: ["run", "--allow-all", join(REPO_ROOT, "apps", "exactl", "main.ts"), "plan", "approve", planId],
              env: { EXA_CONFIG_PATH: configPath },
              stdout: "piped",
              stderr: "piped",
            }).output();
            assertEquals(
              approval.code,
              0,
              new TextDecoder().decode(approval.stderr) || new TextDecoder().decode(approval.stdout),
            );
          },
          afterInjectMs: 60000,
          waitForAfterInject: async () => {
            const rows = await readTraceActivity(configPath, traceId);
            return rows.some((row) => row.action_type === "execution.completed") ||
              rows.some((row) => row.action_type === "execution.failed") ||
              rows.some((row) => row.action_type === "request.failed");
          },
        });

        const rows = await readTraceActivity(configPath, traceId);
        assertEquals(await Deno.readTextFile(join(portal, "src", "marker.txt")), fixtureMarker);
        assertEquals(JSON.stringify(observedRequests).includes(outsideMarker), false);
        if (mode === "invalid-config") {
          assertEquals(requestCount, 0);
          const failures = rows.filter((row) => row.action_type === "request.failed");
          assertEquals(failures.length, 1, JSON.stringify(rows));
          assertEquals(JSON.parse(failures[0].payload).providerReasonCode, "profile_mismatch");
          assertEquals(rows.some((row) => row.action_type === "llm.call.started"), false);
          return;
        }
        if (mode === "unauthorized-write") {
          assertEquals(requestCount, 2);
          assertEquals(rows.filter((row) => row.action_type === "execution.failed").length, 1);
          assertEquals(rows.some((row) => row.action_type === "dynamic_tool_call"), false);
          const terminal = rows.find((row) => row.action_type === "agent.execution_failed");
          assert(terminal);
          assertEquals(JSON.parse(terminal.payload).providerReasonCode, "protocol_invalid");
          return;
        }
        assertEquals(
          requestCount,
          nativeToolsEnabled ? 4 : 3,
          JSON.stringify({
            observedRequests,
            events: rows.map((row) => ({ action_type: row.action_type, payload: row.payload })),
          }),
        );
        assertEquals(observedRequests.every((request) => request.authorization === "Bearer local-fixture-key"), true);
        const firstBody = observedRequests[1].body;
        assertEquals(firstBody.model, "compat-fixture-v1");
        if (nativeToolsEnabled) {
          assertEquals(firstBody.tool_choice, "required");
          const secondBody = observedRequests[2].body;
          assertEquals(secondBody.tool_choice, "auto");
          const replayMessages = secondBody.messages ?? [];
          const replayedTool = replayMessages.find((message) => message.role === "tool");
          assertEquals(replayedTool?.tool_call_id, "phase155-call-1");
          assertEquals(replayedTool?.content?.includes(fixtureMarker), mode !== "traversal");
          if (mode === "traversal") {
            assertEquals(
              replayedTool?.content?.includes("Access denied: Path traversal detected"),
              true,
              replayedTool?.content,
            );
          }
          const toolCall = rows.find((row) => row.action_type === "dynamic_tool_call");
          assert(toolCall, JSON.stringify(rows.map((row) => row.action_type)));
          assertEquals(toolCall!.payload.includes(fixtureMarker), mode !== "traversal");
        } else {
          assertEquals(
            observedRequests.every((request) =>
              request.body.tools === undefined && request.body.tool_choice === undefined
            ),
            true,
          );
          assertEquals(rows.some((row) => row.action_type === "dynamic_tool_call"), false);
        }
        const completed = rows.find((row) => row.action_type === "execution.completed");
        assert(completed, JSON.stringify(rows.map((row) => row.action_type)));
        const generations = rows.filter((row) => row.action_type === "llm.call.completed");
        assert(generations.length >= 2);
        for (const generation of generations) {
          assertEquals(generation.cost_usd, null);
          const payload = JSON.parse(generation.payload);
          assertEquals(payload.cost_usd, undefined);
          assertEquals(payload.cost_status, "unknown");
          assertEquals(payload.model, "compat-fixture-v1");
        }
        assert(rows.some((row) => row.action_type === "llm.usage" && row.cost_usd === null));
        const artifact = await Deno.readTextFile(join(root, "Memory", "Execution", traceId, "summary.md"));
        assert(artifact.includes(fixtureMarker), "the final execution artifact must contain the fixture marker");
      } finally {
        await fixture.shutdown();
        await Deno.remove(root, { recursive: true }).catch(() => {});
      }
    },
  });
}
