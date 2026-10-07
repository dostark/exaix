/**
 * @module AdvancedFlowControlsTest
 * @path tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts
 * @description Executes halt and warning controls on real Solo daemons with strict fixtures.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/portal, @exaix/testing]
 * @related-files [tests/scenario_framework/scenarios/agent_flows/gate_halt.yaml, tests/scenario_framework/scenarios/agent_flows/gate_continue_warning.yaml]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { PathResolver } from "@exaix/portal";
import { withEnv } from "@exaix/testing";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { loadScenarioActivities } from "../../runner/provider_live_evidence.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const OUTPUT_HOME = join(FRAMEWORK_HOME, "output", "phase205", "step1");
const PROMPT_TOKENS = 100;
const COMPLETION_TOKENS = 200;
for (
  const [file, scenarioId, action, status, calls, phaseStep, evaluations, iterations] of [
    ["gate_halt", "gate-halt", "halted", "failed", 1, 1, 1, 0],
    ["gate_continue_warning", "gate-continue-warning", "continued-with-warning", "planned", 2, 1, 1, 0],
    ["gate_retry", "gate-retry", "passed", "planned", 5, 2, 2, 1],
    ["gate_retry_exhausted", "gate-retry-exhausted", "halted", "failed", 6, 2, 3, 2],
    ["gate_retry_budget", "gate-retry-budget", "retry", "failed", 2, 2, 1, 0],
    ["branch_routing", "branch-routing", "bug", "planned", 4, 3, 0, 0],
  ] as const
) {
  Deno.test({
    name: `[phase205 step${phaseStep}] ${scenarioId} real Solo daemon`,
    ignore: Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const workspaceRoot = await Deno.makeTempDir({ prefix: `phase205-${scenarioId}-` });
      const outputDir = join(OUTPUT_HOME, "..", `step${phaseStep}`, scenarioId);
      await Deno.mkdir(outputDir, { recursive: true });
      const cliDir = join(workspaceRoot, ".test-cli");
      await Deno.mkdir(cliDir);
      const exactlExecutable = join(cliDir, "exactl");
      const cliArgs = [
        "run",
        "-A",
        "--config",
        join(REPO_ROOT, "deno.json"),
        join(REPO_ROOT, "apps", "exactl", "main.ts"),
      ];
      await Deno.writeTextFile(
        exactlExecutable,
        `#!/usr/bin/env -S deno run -A --config ${join(REPO_ROOT, "deno.json")}
import { recordGateBudgetUsage, activateGateBudgetRequest } from ${
          JSON.stringify(new URL("../helpers/gate_budget_fixture.ts", import.meta.url).href)
        };
const result = await new Deno.Command(Deno.execPath(), { args: [...${
          JSON.stringify(cliArgs)
        }, ...Deno.args], stdin: "inherit", stdout: "inherit", stderr: "inherit" }).spawn().status;
if (result.success && ${
          JSON.stringify(file === "gate_retry_budget")
        } && Deno.args[0] === "request") await recordGateBudgetUsage(${JSON.stringify(workspaceRoot)});
if (result.success && ${
          JSON.stringify(file === "gate_retry_budget")
        } && Deno.args[0] === "daemon" && Deno.args[1] === "start") await activateGateBudgetRequest(${
          JSON.stringify(workspaceRoot)
        });
Deno.exit(result.code);
`,
      );
      await Deno.chmod(exactlExecutable, 0o755);
      try {
        await Deno.writeTextFile(
          join(workspaceRoot, "exa.config.toml"),
          `
${file === "gate_retry_budget" ? "max_flow_retry_cost_usd = 0.01" : ""}
[system]
root = "${workspaceRoot}"
[ai]
provider = "mock"
model = "phase205-fixture"
[models.mock]
provider = "mock"
model = "phase205-fixture"
[agents]
default_model = "mock"
[ai.mock]
strategy = "recorded"
strict = true
fixtures_dir = "${
            join(
              FRAMEWORK_HOME,
              "fixtures",
              "mock_recordings",
              "phase205",
              file === "branch_routing" ? "branches" : "gates",
            )
          }"
${
            file === "gate_retry_budget"
              ? `
[catalog.models."mock/phase205-fixture"]
model_provider = "mock"
[catalog.services.retry-fixture]
adapter = "mock"
transport = "local"
interface = "api"
serves = { "mock/phase205-fixture" = "phase205-fixture" }
`
              : ""
          }
[quality_gate]
enabled = false
[request_analysis]
enabled = false
`,
        );
        let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
        await withEnv({ PATH: `${cliDir}:${Deno.env.get("PATH") ?? ""}` }, async () => {
          run = await runSyntheticScenario({
            frameworkHome: FRAMEWORK_HOME,
            scenarioPath: `scenarios/agent_flows/${file}.yaml`,
            workspaceRoot,
            outputDir,
            mode: ScenarioExecutionMode.AUTO,
            exactlExecutable,
          });
        });
        assert(run);
        const journal = loadScenarioActivities(join(workspaceRoot, ".exa", "journal.db"), 0);
        await Deno.writeTextFile(join(outputDir, "journal-evidence.json"), JSON.stringify(journal, null, 2));
        await Deno.copyFile(join(workspaceRoot, ".exa", "daemon.log"), join(outputDir, "daemon.log"));
        assertEquals(run.manifest.outcome, "success", JSON.stringify(run.manifest.steps));
        const created = journal.activities.filter((row) =>
          row.action_type === "request.created" && (JSON.parse(row.payload) as { via?: string }).via === "cli"
        );
        assertEquals(created.length, 1);
        const traceId = created[0].trace_id;
        const activities = journal.activities.filter((row) => row.trace_id === traceId);
        const gates = activities.filter((row) => row.action_type === "flow.gate.evaluated");
        assertEquals(gates.length, evaluations);
        assertEquals(activities.filter((row) => row.action_type === "flow.loop.iteration").length, iterations);
        assertEquals(
          gates.map((row) => JSON.parse(row.payload).attempt),
          Array.from({ length: evaluations }, (_, i) => i + 1),
        );
        if (file === "branch_routing") {
          const decisions = activities.filter((row) => row.action_type === "flow.branch.decided");
          assertEquals(decisions.length, 1);
          const decision = JSON.parse(decisions[0].payload);
          assertEquals(decision.data, { category: "bug", items: [1, 2] });
          assertEquals(decision.chosen, "bug");
          assertEquals(decision.notTaken, ["feature", "other"]);
          assertEquals(decision.traceId, traceId);
          assertEquals(
            activities.filter((row) => row.action_type === "flow.step.started").map((row) =>
              JSON.parse(row.payload).stepId
            ),
            ["classify", "bug", "bug-child", "join"],
          );
          assertEquals(
            activities.filter((row) => row.action_type === "flow.step.skipped").map((
              row,
            ) => [JSON.parse(row.payload).stepId, JSON.parse(row.payload).skipCode]),
            [["feature", "branch_not_taken"], ["other", "branch_not_taken"], ["feature-child", "branch_not_taken"], [
              "other-child",
              "branch_not_taken",
            ]],
          );
        } else {
          const gate = JSON.parse(gates[gates.length - 1].payload) as {
            action: string;
            attempt: number;
            score: number;
            threshold: number;
            passed: boolean;
            traceId: string;
          };
          assertEquals(gate, {
            ...gate,
            action,
            attempt: evaluations,
            score: action === "passed" ? 1 : 0.2,
            threshold: 0.8,
            passed: action === "passed",
            traceId,
          });
          assertEquals(gates[0].trace_id, traceId);
        }
        const generations = activities.filter((row) => row.action_type === "llm.call.completed");
        assertEquals(generations.length, calls);
        assertEquals(generations.map((row) => row.trace_id), Array(calls).fill(traceId));
        assertEquals(generations.map((row) => row.prompt_tokens), Array(calls).fill(PROMPT_TOKENS));
        const downstream = activities.filter((row) =>
          row.action_type === "flow.step.started" &&
          (JSON.parse(row.payload) as { stepId: string }).stepId === (file === "branch_routing" ? "join" : "after")
        );
        assertEquals(downstream.length, status === "failed" ? 0 : 1);
        const failed = activities.filter((row) => row.action_type === "flow.failed");
        assertEquals(failed.length, status === "failed" ? 1 : 0);
        if (status === "failed") {
          assertEquals(
            (JSON.parse(failed[0].payload) as { reasonCode: string }).reasonCode,
            file === "gate_retry_budget" ? "flow_retry_budget_exceeded" : "gate_halted",
          );
        }
        if (file === "gate_retry_budget") {
          const usage = activities.filter((row) => row.action_type === "llm.usage");
          assertEquals(usage.filter((row) => JSON.parse(row.payload).fixture_usage).length, 2);
          assertEquals(usage.filter((row) => !JSON.parse(row.payload).fixture_usage).length, 2);
          assertEquals(usage.reduce((sum, row) => sum + (JSON.parse(row.payload).cost_usd ?? 0), 0), 0.01);
          assert(activities.filter((row) => row.action_type === "binding.resolved").length >= 2);
        }
        const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
        const requests = await new PathResolver(config).resolve("@Workspace/Requests");
        const requestNames: string[] = [];
        for await (const entry of Deno.readDir(requests)) {
          if (entry.isFile && entry.name.endsWith(".md")) requestNames.push(entry.name);
        }
        assertEquals(requestNames.length, 1);
        const content = await Deno.readTextFile(
          await new PathResolver(config).resolve(`@Workspace/Requests/${requestNames[0]}`),
        );
        assertStringIncludes(content, `status: ${status}`);
        assert(generations.every((row) => row.completion_tokens === COMPLETION_TOKENS));
      } finally {
        await new Deno.Command(exactlExecutable, {
          args: ["daemon", "stop"],
          cwd: workspaceRoot,
          env: { EXA_CONFIG_PATH: join(workspaceRoot, "exa.config.toml") },
        }).output();
        await Deno.remove(workspaceRoot, { recursive: true });
      }
    },
  });
}
