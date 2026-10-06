#!/usr/bin/env -S deno run -A
/**
 * @module FlowBlueprintDelegateFixture
 * @path tests/scenario_framework/fixtures/cli/flow_blueprint_delegate.ts
 * @description Replays keyed flow recordings through the Claude CLI result dialect.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/flow_blueprint_setup_test.ts, tests/scenario_framework/fixtures/flow_blueprints/cli_delegate.toml]
 */
interface IRecording {
  response: string;
  tokens: { input: number; output: number };
  callSite: { scenarioId: string; stepId: string; flowStepId: string; callIndex: number };
}

const modelIndex = Deno.args.indexOf("--model");
const key = modelIndex < 0 ? "" : Deno.args[modelIndex + 1];
if (!key || !/^[a-z0-9_-]+__[a-z0-9_-]+__[a-z0-9_-]+__\d+$/.test(key)) {
  throw new Error("Invalid recording key");
}
const delegatePath = new URL(import.meta.url);
delegatePath.pathname = await Deno.realPath(delegatePath);
const path = new URL(`../mock_recordings/flow_blueprints/${key}.json`, delegatePath);
const recording = JSON.parse(await Deno.readTextFile(path)) as IRecording;
const site = recording.callSite;
if (!site || [site.scenarioId, site.stepId, site.flowStepId, site.callIndex].join("__") !== key) {
  throw new Error("Recording call-site does not match its key");
}
if (
  typeof recording.response !== "string" || !recording.tokens ||
  typeof recording.tokens.input !== "number" || typeof recording.tokens.output !== "number"
) {
  throw new Error("Invalid CLI recording");
}
console.log(JSON.stringify({
  type: "result",
  result: recording.response,
  usage: { input_tokens: recording.tokens.input, output_tokens: recording.tokens.output },
}));
