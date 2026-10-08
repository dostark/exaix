/**
 * @module LegacyFlowCase
 * @path tests/scenario_framework/tests/helpers/legacy_flow_case.ts
 * @description Runs unchanged blueprint regression scenarios with compiled edition binaries and committed recordings.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/testing]
 * @related-files [tests/scenario_framework/tests/integration/advanced_flows_cutover_test.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { FlowLoader } from "@exaix/flow";
import { withEnv } from "@exaix/testing";
import { loadScenarioActivities } from "../../runner/provider_live_evidence.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { resolveFlowBinaries } from "./compiled_flow_fixture.ts";
import { retainAdvancedFlowEvidence } from "./advanced_flow_evidence.ts";
import { ExpectedCallDialect, loadKeyedRecordings } from "./expected_call_manifest.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const FIXTURE_DIR = "fixtures/mock_recordings/flow_blueprints";
const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

export async function runLegacyFlowCase(scenarioId: string, edition: string, expectedCalls: number): Promise<void> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: `phase205-legacy-${scenarioId}-` });
  const outputDir = join(FRAMEWORK_HOME, "output", "phase205", "step9", "legacy", scenarioId);
  await Deno.mkdir(outputDir, { recursive: true });
  const binaries = await resolveFlowBinaries(edition);
  const cliDir = join(workspaceRoot, ".test-cli");
  await Deno.mkdir(cliDir);
  const exactlExecutable = join(cliDir, "exactl");
  await Deno.writeTextFile(
    exactlExecutable,
    `#!/usr/bin/env -S deno run -A --config ${join(REPO_ROOT, "deno.json")}
import { startCompiledFlowDaemon } from ${JSON.stringify(new URL("./compiled_flow_fixture.ts", import.meta.url).href)};
if (Deno.args[0] === "daemon" && Deno.args[1] === "start") {
  const code = await startCompiledFlowDaemon(${JSON.stringify(workspaceRoot)}, ${JSON.stringify(binaries)});
  if (code === 0) console.log("daemon.started");
  Deno.exit(code);
}
const result = await new Deno.Command(${
      JSON.stringify(binaries.cli)
    }, {args: Deno.args, stdin: "inherit", stdout: "inherit", stderr: "inherit"}).spawn().status;
Deno.exit(result.code);
`,
  );
  await Deno.chmod(exactlExecutable, 0o755);
  await Deno.writeTextFile(
    join(workspaceRoot, "exa.config.toml"),
    `
[system]
root = "${workspaceRoot}"
log_level = "debug"
[ai]
provider = "mock"
model = "test"
[models.mock]
provider = "mock"
model = "test"
[agents]
default_model = "mock"
[ai.mock]
strategy = "recorded"
strict = true
fixtures_dir = "${join(FRAMEWORK_HOME, FIXTURE_DIR)}"
[quality_gate]
enabled = false
[request_analysis]
enabled = false
`,
  );
  try {
    let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
    await withEnv({
      PATH: `${cliDir}:${Deno.env.get("PATH") ?? ""}`,
      EXAIX_EDITION: edition,
      EXA_DAEMON_SCRIPT: null,
      EXA_CONFIG_PATH: join(workspaceRoot, "exa.config.toml"),
    }, async () => {
      run = await runSyntheticScenario({
        frameworkHome: FRAMEWORK_HOME,
        scenarioPath: `scenarios/flow_blueprints/${scenarioId}.yaml`,
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
      row.action_type === "request.created" && JSON.parse(row.payload).via === "cli"
    );
    assertEquals(created.length, 1);
    const traceId = created[0].trace_id;
    const activities = journal.activities.filter((row) => row.trace_id === traceId);
    assertEquals(activities.filter((row) => row.action_type === "llm.call.completed").length, expectedCalls);
    assertEquals(activities.filter((row) => row.action_type === "llm.call.failed").length, 0);
    const request = await Deno.readTextFile(
      join(FRAMEWORK_HOME, "fixtures/requests/flow_blueprints", `${scenarioId}.md`),
    );
    const match = request.match(FRONTMATTER);
    assert(match);
    const flowId = (parseYaml(match[1]) as Record<string, string>).flow ?? "";
    const flow = flowId ? await new FlowLoader(join(REPO_ROOT, "Blueprints", "Flows")).loadFlow(flowId) : null;
    if (flow) {
      assertEquals(activities.filter((row) => row.action_type === "flow.completed").length, 1);
      assertEquals(activities.filter((row) => row.action_type === "flow.step.completed").length, flow.steps.length);
      assertEquals(
        activities.filter((row) =>
          row.action_type === "flow.step.completed" && JSON.parse(row.payload).strategy === "cli_delegate"
        ).length,
        flow.steps.filter((step) => step.strategy === "cli_delegate").length,
      );
    }
    const recordings = (await loadKeyedRecordings(join(FRAMEWORK_HOME, FIXTURE_DIR))).filter((recording) =>
      recording.callSite?.scenarioId === scenarioId
    );
    await retainAdvancedFlowEvidence({
      spec: { scenarioId, edition },
      workspaceRoot,
      outputDir,
      journal,
      traceId,
      compiledCli: binaries.cli,
      compiledDaemon: binaries.daemon,
      expected: {
        scenarioId,
        edition,
        flow: flowId,
        fixtureDir: FIXTURE_DIR,
        requestStepId: scenarioId === "dogfood_context" ? "submit-request" : "submit-flow-request",
        selectedPath: flow?.steps.map((step) => step.id) ?? [],
        expectedFailure: null,
        gateEvaluations: {},
        calls: recordings.map((recording) => ({
          lane: recording.callSite!.flowStepId!,
          callIndex: recording.callSite!.callIndex,
          dialect: ExpectedCallDialect.AGENT,
        })),
      },
    });
  } finally {
    await new Deno.Command(exactlExecutable, {
      args: ["daemon", "stop"],
      cwd: workspaceRoot,
      env: { EXA_CONFIG_PATH: join(workspaceRoot, "exa.config.toml") },
    }).output();
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}
