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
  const [file, scenarioId, action, status, calls, phaseStep, evaluations, iterations, edition = "solo"] of [
    ["gate_halt", "gate-halt", "halted", "failed", 1, 1, 1, 0],
    ["gate_continue_warning", "gate-continue-warning", "continued-with-warning", "planned", 2, 1, 1, 0],
    ["gate_retry", "gate-retry", "passed", "planned", 5, 2, 2, 1],
    ["gate_retry_exhausted", "gate-retry-exhausted", "halted", "failed", 6, 2, 3, 2],
    ["gate_retry_budget", "gate-retry-budget", "retry", "failed", 2, 2, 1, 0],
    ["branch_routing", "branch-routing", "bug", "planned", 4, 3, 0, 0],
    ["architecture_decision", "architecture-decision", "majority", "planned", 5, 4, 0, 0, "team"],
    ["architecture_decision_solo", "architecture-decision-solo", "unavailable", "failed", 0, 4, 0, 0, "solo"],
  ] as const
) {
  Deno.test({
    name: `[phase205 step${phaseStep}] ${scenarioId} real ${edition} daemon`,
    ignore: phaseStep !== 4 && Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const workspaceRoot = await Deno.makeTempDir({ prefix: `phase205-${scenarioId}-` });
      const outputDir = join(OUTPUT_HOME, "..", `step${phaseStep}`, scenarioId);
      await Deno.mkdir(outputDir, { recursive: true });
      const cliDir = join(workspaceRoot, ".test-cli");
      await Deno.mkdir(cliDir);
      const exactlExecutable = join(cliDir, "exactl");
      const compiled = phaseStep === 4;
      const compiledCli = join(REPO_ROOT, "dist", "bin", `exactl-${edition}-${Deno.build.target}`);
      const compiledDaemon = join(
        REPO_ROOT,
        "dist",
        "bin",
        `${edition === "team" ? "exaix-team" : "exaix"}-${Deno.build.target}`,
      );
      if (compiled) {
        for (const binary of [compiledCli, compiledDaemon]) {
          assert((await Deno.stat(binary)).isFile, `Required edition binary missing: ${binary}`);
        }
      }
      const cliArgs = compiled ? [] : [
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
if (${JSON.stringify(compiled)} && Deno.args[0] === "daemon" && Deno.args[1] === "start") {
  const launched = await new Deno.Command("bash", { args: ["-c", 'nohup "$1" > "$2" 2>&1 < /dev/null & echo $!', "--", ${
          JSON.stringify(compiledDaemon)
        }, ${JSON.stringify(join(workspaceRoot, ".exa", "daemon.log"))}], cwd: ${
          JSON.stringify(workspaceRoot)
        } }).output();
  const pid = new TextDecoder().decode(launched.stdout).trim();
  if (!launched.success || !/^[0-9]+$/.test(pid)) throw new Error("Compiled daemon launch failed");
  await Deno.writeTextFile(${JSON.stringify(join(workspaceRoot, ".exa", "daemon.pid"))}, pid);
  const ready = await new Deno.Command(${
          JSON.stringify(compiledCli)
        }, { args: ["journal", "wait", "--event", "daemon.ready", "--timeout", "30"], stdout: "inherit", stderr: "inherit" }).spawn().status;
  if (ready.success) console.log("daemon.started");
  Deno.exit(ready.code);
}
const result = await new Deno.Command(${JSON.stringify(compiled ? compiledCli : Deno.execPath())}, { args: [...${
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
              phaseStep === 4 ? "voting" : file === "branch_routing" ? "branches" : "gates",
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
        await withEnv({
          PATH: `${cliDir}:${Deno.env.get("PATH") ?? ""}`,
          EXAIX_EDITION: edition,
          EXA_DAEMON_SCRIPT: null,
          EXA_CONFIG_PATH: join(workspaceRoot, "exa.config.toml"),
        }, async () => {
          run = await runSyntheticScenario({
            frameworkHome: FRAMEWORK_HOME,
            scenarioPath: `scenarios/${phaseStep === 4 ? "flow_blueprints" : "agent_flows"}/${file}.yaml`,
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
        } else if (phaseStep === 4) {
          const resolved = activities.filter((row) => row.action_type === "voting.step.consensus_resolved");
          assertEquals(resolved.length, edition === "team" ? 1 : 0);
          assertEquals(
            activities.filter((row) => row.action_type === "flow.step.started").map((row) =>
              JSON.parse(row.payload).stepId
            ),
            edition === "team" ? ["context", "vote", "adr"] : [],
          );
          if (edition === "team") {
            const votingStarted = activities.filter((row) => row.action_type === "voting.started");
            const votingResolved = activities.filter((row) => row.action_type === "voting.resolved");
            assertEquals(votingStarted.length, 1);
            assertEquals(votingResolved.length, 1);
            assertEquals(JSON.parse(votingResolved[0].payload).winner_runner_id, "software-architect");
            const payload = JSON.parse(resolved[0].payload);
            assertEquals(payload.candidate_count, 3);
            assertEquals(payload.strategy, "majority");
            assertEquals(payload.consensus_reached, true);
            assertEquals(activities.filter((row) => row.action_type === "flow.completed").length, 1);
          }
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
        if (phaseStep !== 4) {
          assertEquals(generations.map((row) => row.prompt_tokens), Array(calls).fill(PROMPT_TOKENS));
        }
        const downstream = activities.filter((row) =>
          row.action_type === "flow.step.started" &&
          (JSON.parse(row.payload) as { stepId: string }).stepId ===
            (phaseStep === 4 ? "adr" : file === "branch_routing" ? "join" : "after")
        );
        assertEquals(downstream.length, status === "failed" ? 0 : 1);
        const failed = activities.filter((row) => row.action_type === "flow.failed");
        assertEquals(failed.length, status === "failed" ? 1 : 0);
        if (status === "failed") {
          assertEquals(
            (JSON.parse(failed[0].payload) as { reasonCode: string }).reasonCode,
            phaseStep === 4
              ? "capability_unavailable"
              : file === "gate_retry_budget"
              ? "flow_retry_budget_exceeded"
              : "gate_halted",
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
        if (phaseStep === 4 && edition === "team") {
          const planNames: string[] = [];
          for await (const entry of Deno.readDir(join(workspaceRoot, "Workspace", "Plans"))) {
            if (entry.isFile && entry.name.endsWith(".md")) planNames.push(entry.name);
          }
          assertEquals(planNames.length, 1);
          const plan = await Deno.readTextFile(
            await new PathResolver(config).resolve(`@Workspace/Plans/${planNames[0]}`),
          );
          assertStringIncludes(plan, "SQLite majority ADR");
        }
        if (phaseStep !== 4) assert(generations.every((row) => row.completion_tokens === COMPLETION_TOKENS));
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
