/**
 * @module FlowBlueprintSetupTest
 * @path tests/scenario_framework/tests/unit/flow_blueprint_setup_test.ts
 * @description Verifies mock CLI setup and model configuration for shipped flow scenarios.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/flow_blueprints, tests/scenario_framework/fixtures/cli/flow_blueprint_delegate.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import { ConfigService } from "@exaix/core/config";
import { UserRequestSchema } from "@exaix/schemas/input_validation.ts";
import { mergeAsContext } from "@exaix/core/func";
import { LlmClient } from "@exaix/ai/llm_client.ts";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { FlowLoader } from "@exaix/flow";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { expandVariablesInStep } from "../../runner/synthetic_runner.ts";
import { resolveCellConfig } from "../../runner/matrix_expander.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const DELEGATE = new URL("../../fixtures/cli/flow_blueprint_delegate.ts", import.meta.url);

for (
  const [scenarioId, flowId] of [["dogfood_loop", "dogfood-loop"], ["feature_development", "feature-development"], [
    "refactoring",
    "refactoring",
  ]]
) {
  Deno.test(`[flow blueprint setup] ${scenarioId} supplies a portal and keyed CLI replay for every delegate`, async () => {
    const scenario = ScenarioSchema.parse(
      parseYaml(await Deno.readTextFile(`${FRAMEWORK_HOME}scenarios/flow_blueprints/${scenarioId}.yaml`)),
    );
    const submit = scenario.steps.find((step) => step.id === "submit-flow-request")!;
    const portalIndex = submit.args!.indexOf("--portal");
    assert(portalIndex >= 0, "CLI delegation requires a request portal");
    assert(scenario.portals.some((portal) => portal.alias === submit.args![portalIndex + 1]));
    const presetPath = scenario.steps.find((step) => step.id === "start-daemon")!.env!.EXA_CONFIG_PATH;
    const text = await Deno.readTextFile(presetPath.replaceAll("$FRAMEWORK_HOME", FRAMEWORK_HOME));
    const config = ConfigSchema.parse(
      parseToml(resolveCellConfig(text, { workspaceRoot: REPO_ROOT, worktreePath: REPO_ROOT.replace(/\/$/, "") })),
    );
    assertEquals(config.cli_delegate?.tool, "claude-code");
    assertEquals(config.cli_delegate?.bin_overrides, ["claude"]);
    assert(scenario.steps.some((step) => step.id === "prepare-delegate" && step.type === "run-script"));
    assert(
      scenario.steps.findIndex((step) => step.id === "prepare-delegate") <
        scenario.steps.findIndex((step) => step.id === "start-daemon"),
    );
    assertEquals(
      scenario.steps.find((step) => step.id === "start-daemon")!.env!.PATH,
      "$WORKSPACE_ROOT/.mock-cli:$PATH",
    );
    const expanded = expandVariablesInStep(scenario.steps.find((step) => step.id === "start-daemon")!, {
      ...Deno.env.toObject(),
      WORKSPACE_ROOT: REPO_ROOT,
      FRAMEWORK_HOME,
    });
    assertEquals(expanded.env!.PATH, `${REPO_ROOT}/.mock-cli:${Deno.env.get("PATH")}`);
    assertEquals(config.ai?.provider, "mock");
    assertEquals(config.ai?.model, "test");
    const flow = await new FlowLoader(`${REPO_ROOT}Blueprints/Flows`).loadFlow(flowId);
    for (const step of flow.steps.filter((step) => step.strategy === "cli_delegate")) {
      const binding = scenario.bindings?.[`flow:${flowId}/step:${step.id}`];
      assertEquals(binding?.service, "claude-code");
      assertEquals(binding?.service_model_id, `${scenarioId}__submit-flow-request__${step.id}__0`);
      await Deno.stat(`${FRAMEWORK_HOME}fixtures/mock_recordings/flow_blueprints/${binding?.service_model_id}.json`);
    }
    assert(
      scenario.steps.some((step) =>
        step.type === "journal-assert" && step.action_type === "flow.step.completed" &&
        step.expect_count === flow.steps.length
      ),
    );
  });
}

Deno.test("[flow blueprint setup] the dynamic Team scenario receives an explicit mock model", () => {
  const config = new ConfigService(`${FRAMEWORK_HOME}exa.config.toml`).getAll();
  assertEquals(config.ai?.provider, "mock");
  assertEquals(config.ai?.model, "test");
});

for (const useSymlink of [false, true]) {
  Deno.test(`[flow blueprint delegate] emits the exact keyed recording with symlink=${useSymlink}`, async () => {
    const directory = await Deno.makeTempDir();
    try {
      const key = "dogfood_loop__submit-flow-request__review__0";
      const fixture = JSON.parse(
        await Deno.readTextFile(`${FRAMEWORK_HOME}fixtures/mock_recordings/flow_blueprints/${key}.json`),
      );
      const command = useSymlink ? `${directory}/claude` : DELEGATE.pathname;
      if (useSymlink) await Deno.symlink(DELEGATE.pathname, command);
      const run = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", command, "--model", key, "--print", "Review the output"],
      }).output();
      assertEquals(run.code, 0, new TextDecoder().decode(run.stderr));
      const result = JSON.parse(new TextDecoder().decode(run.stdout));
      assertEquals(result.type, "result");
      assertEquals(result.result, fixture.response);
      assertEquals(result.usage, { input_tokens: fixture.tokens.input, output_tokens: fixture.tokens.output });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}

Deno.test("[flow blueprint setup] feature review recordings fit the production aggregate input limit", async () => {
  const responses = await Promise.all(["implement-feature", "write-tests"].map(async (step) => {
    const fixture = JSON.parse(
      await Deno.readTextFile(
        `${FRAMEWORK_HOME}fixtures/mock_recordings/flow_blueprints/feature_development__submit-flow-request__${step}__0.json`,
      ),
    );
    return fixture.response as string;
  }));
  UserRequestSchema.parse(mergeAsContext(responses));
});

Deno.test("[flow blueprint setup] Team exploration recording uses the dynamic completion dialect", async () => {
  const fixture = JSON.parse(
    await Deno.readTextFile(
      `${FRAMEWORK_HOME}fixtures/mock_recordings/flow_blueprints/analyze-codebase__submit-flow-request__explore__0.json`,
    ),
  );
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: [fixture.response] });
  const client = new LlmClient(undefined, provider);
  const result = await client.reasonNextAction({
    agent_role: {
      agent_role: "senior-coder",
      name: "Senior Software Engineer",
      version: "1.0.0",
      created: "2026-10-06T00:00:00.000Z",
      created_by: "scenario-framework",
      capabilities: [],
    },
    stepObjective: "Explore codebase structure and gather context",
    accumulatedContext: "Analyze the fixture codebase",
    availableTools: [],
    iteration: 1,
    maxIterations: 10,
  });
  assertEquals(result.done, true);
  assert(result.output?.includes("Target codebase not found"));
});
