/**
 * @module ModelCommandCliTest
 * @path apps/exactl/tests/model_command_cli_test.ts
 * @description Runs the real exactl binary against model use, model candidates and the model route commands in a fresh workspace.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/model_command.ts, apps/exactl/src/commands/config_commands.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_AGENTS_PATH } from "@exaix/shared";
import { readFixtureTextSync } from "@exaix/testing";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runExactlSeededWorkspace, runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const CANDIDATE_ENTRY = "anthropic";
const REQUEST_FILE = "request.md";

async function seedRoutingWorkspace(root: string): Promise<void> {
  const blueprintsDir = pathBuilders.blueprintsPath(root, DEFAULT_AGENTS_PATH);
  await Deno.mkdir(blueprintsDir, { recursive: true });
  const fixture = (name: string) =>
    readFixtureTextSync(import.meta.url, "cli", "commands", "routing_commands_test", name);
  await Deno.writeTextFile(join(blueprintsDir, "senior-coder.md"), fixture("fixture_1.md"));
  await Deno.writeTextFile(join(blueprintsDir, "default-agent.md"), fixture("fixture_2.md"));
  await Deno.writeTextFile(
    join(root, REQUEST_FILE),
    "---\ntrace_id: trace-1\nagent_role: senior-coder\nallow_dynamic_routing: true\n---\nPlease generate code for the new feature.\n",
  );
}

Deno.test("model use sets the provider the way config set-provider did", async () => {
  const [use, provider, model] = await runExactlSequenceInTempWorkspace([
    ["model", "use", "ollama"],
    ["config", "get", "ai.provider"],
    ["config", "get", "models.default.model"],
  ]);
  assertEquals(use.code, 0, use.stderr);
  assertStringIncludes(provider.stdout + provider.stderr, "ollama");
  assertStringIncludes(model.stdout + model.stderr, "llama3.2");
});

Deno.test("model use provider:model sets ai.provider and models.default.model to the given model", async () => {
  const [use, provider, model] = await runExactlSequenceInTempWorkspace([
    ["model", "use", "ollama:codellama:13b"],
    ["config", "get", "ai.provider"],
    ["config", "get", "models.default.model"],
  ]);
  assertEquals(use.code, 0, use.stderr);
  assertStringIncludes(provider.stdout + provider.stderr, "ollama");
  assertStringIncludes(model.stdout + model.stderr, "codellama:13b");
});

Deno.test("model candidates lists the same entries as config model did", async () => {
  const [set, list] = await runExactlSequenceInTempWorkspace([
    ["model", "candidates", "--size", "S", CANDIDATE_ENTRY],
    ["model", "candidates", "--list"],
  ]);
  assertEquals(set.code, 0, set.stderr);
  assertStringIncludes(list.stdout, CANDIDATE_ENTRY);
});

Deno.test("model candidates without --size or --list exits 1 and names the option", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "candidates"]]);
  assertEquals(run.code, FAILURE_EXIT_CODE);
  assertStringIncludes(run.stderr + run.stdout, "--size <S|M|L|XL> is required");
});

Deno.test("model route explain prints the ranking that routing explain printed", async () => {
  const [run] = await runExactlSeededWorkspace(seedRoutingWorkspace, [[
    "model",
    "route",
    "explain",
    "--request",
    REQUEST_FILE,
  ]]);
  assertEquals(run.code, 0, run.stderr);
  assertStringIncludes(run.stdout + run.stderr, "selected_agent_role");
  assertStringIncludes(run.stdout, "senior-coder@");
  assertStringIncludes(run.stdout, "score=");
});

Deno.test("model route explain without --request exits 1 and names the option", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "route", "explain"]]);
  assertEquals(run.code, FAILURE_EXIT_CODE);
  assertStringIncludes(run.stderr + run.stdout, "The --request option is required.");
});

Deno.test("model route validate exits 1 for a policy file that does not exist", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "route", "validate", "missing-policy.yaml"]]);
  assertEquals(run.code, FAILURE_EXIT_CODE);
});

Deno.test("model refresh outside the Team live registry exits 1 with the guidance", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "refresh"]]);
  assertEquals(run.code, FAILURE_EXIT_CODE);
  assertStringIncludes(run.stderr + run.stdout, "requires the Team live registry");
});

Deno.test("model use with an empty provider or an empty model exits 2 with the expected form", async () => {
  const [emptyModel, emptyProvider] = await runExactlSequenceInTempWorkspace([
    ["model", "use", "ollama:"],
    ["model", "use", ":llama3.2"],
  ]);
  for (const run of [emptyModel, emptyProvider]) {
    assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
    assertStringIncludes(run.stderr, "Expected <provider> or <provider>:<model>");
  }
});
