/**
 * @module ToolsPackContractTest
 * @path tests/eval/tools_pack_contract_test.ts
 * @description Structural guards over the `mcp_tools_extended` scenario pack that catch,
 *   without booting a daemon, the defect classes Step 7's cutover probe found in scenarios
 *   that had been marked green but never executed: request fixtures that do not exist,
 *   `exactl` invocations naming subcommands the CLI does not define, and `file-found`
 *   criteria anchored on absolute paths (the criterion walks the sandbox workspace and
 *   matches workspace-relative paths, so an absolute pattern can never match).
 * @architectural-layer Test
 * @dependencies [tests/scenario_framework/runner/scenario_catalog.ts]
 * @related-files [tests/scenario_framework/scenarios/mcp_tools_extended/, tests/eval/tool_eval_parity_test.ts]
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, isAbsolute, join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");
const PACK_DIR = join(FRAMEWORK_HOME, "scenarios", "mcp_tools_extended");

/** `exactl` subcommands the scenario pack is allowed to invoke, per apps/exactl/src/exactl.ts. */
const KNOWN_EXACTL_COMMANDS = new Set([
  "daemon",
  "request",
  "plan",
  "review",
  "journal",
  "config",
  "git",
  "flow",
  "memory",
  "portal",
  "wait",
  "eval",
  "sh",
]);

/** `<command> <first-arg>` pairs that do NOT exist on the CLI and must never be invoked. */
const FICTIONAL_INVOCATIONS = new Set([
  "flow run",
  "journal query --limit",
]);

interface IScenarioStepYaml {
  id?: string;
  type?: string;
  command?: string;
  args?: string[];
  output_criteria?: ICriterionYaml[];
  input_criteria?: ICriterionYaml[];
}

interface ICriterionYaml {
  id?: string;
  kind?: string;
  path_pattern?: string;
}

interface IScenarioYaml {
  id: string;
  request_fixture?: string;
  flow_fixture?: string;
  steps?: IScenarioStepYaml[];
}

async function loadPackScenarios(): Promise<{ file: string; scenario: IScenarioYaml }[]> {
  const loaded: { file: string; scenario: IScenarioYaml }[] = [];
  for await (const entry of Deno.readDir(PACK_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;
    const raw = await Deno.readTextFile(join(PACK_DIR, entry.name));
    loaded.push({ file: entry.name, scenario: parseYaml(raw) as IScenarioYaml });
  }
  loaded.sort((a, b) => a.file.localeCompare(b.file));
  return loaded;
}

function fileExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("tools_pack_contract — every request_fixture and flow_fixture resolves on disk", async () => {
  const scenarios = await loadPackScenarios();
  const missing: string[] = [];
  for (const { file, scenario } of scenarios) {
    for (const ref of [scenario.request_fixture, scenario.flow_fixture]) {
      if (!ref) continue;
      if (!fileExists(join(FRAMEWORK_HOME, ref))) missing.push(`${file} -> ${ref}`);
    }
  }
  assertEquals(missing, [], `scenario fixtures referenced but absent:\n${missing.join("\n")}`);
});

Deno.test("tools_pack_contract — no scenario invokes a fictional exactl subcommand", async () => {
  const scenarios = await loadPackScenarios();
  const offenders: string[] = [];
  for (const { file, scenario } of scenarios) {
    for (const step of scenario.steps ?? []) {
      if (step.type !== "exactl" || !step.command) continue;
      if (!KNOWN_EXACTL_COMMANDS.has(step.command)) {
        offenders.push(`${file}:${step.id} -> unknown command "${step.command}"`);
        continue;
      }
      const first = step.args?.[0];
      if (first && FICTIONAL_INVOCATIONS.has(`${step.command} ${first}`)) {
        offenders.push(`${file}:${step.id} -> "${step.command} ${first}" does not exist`);
      }
      for (const arg of step.args ?? []) {
        if (FICTIONAL_INVOCATIONS.has(`${step.command} ${first} ${arg}`)) {
          offenders.push(`${file}:${step.id} -> "${step.command} ${first} ${arg}" does not exist`);
        }
      }
    }
  }
  assertEquals(offenders, [], `fictional CLI invocations:\n${offenders.join("\n")}`);
});

Deno.test("tools_pack_contract — no file-found criterion uses an absolute path_pattern", async () => {
  const scenarios = await loadPackScenarios();
  const offenders: string[] = [];
  for (const { file, scenario } of scenarios) {
    for (const step of scenario.steps ?? []) {
      const criteria = [...(step.input_criteria ?? []), ...(step.output_criteria ?? [])];
      for (const criterion of criteria) {
        if (criterion.kind !== "file-found" || !criterion.path_pattern) continue;
        if (isAbsolute(criterion.path_pattern)) {
          offenders.push(`${file}:${step.id}:${criterion.id} -> ${criterion.path_pattern}`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `file-found matches sandbox-relative paths only; use file-exists for absolute paths:\n${offenders.join("\n")}`,
  );
});

Deno.test("tools_pack_contract — no scenario invokes git as a shell command (Phase 156 closure)", async () => {
  const scenarios = await loadPackScenarios();
  const offenders: string[] = [];
  for (const { file, scenario } of scenarios) {
    for (const step of scenario.steps ?? []) {
      if (step.type !== "shell" || !step.command) continue;
      if (step.command === "git") {
        offenders.push(`${file}:${step.id} -> invokes git directly (should be tools/call to git_* MCP handler)`);
      }
      for (const arg of step.args ?? []) {
        if (arg === "git" || arg.endsWith("/git") || arg.includes("git ")) {
          offenders.push(`${file}:${step.id} -> shell arg invokes git (should be tools/call)`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `pack scenarios must not shell-invoke git — use tools/call to git_* MCP handlers:\n${offenders.join("\n")}`,
  );
});
