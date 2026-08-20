#!/usr/bin/env -S deno run -A
/**
 * @module RegenerateTerminalBenchScenarios
 * @path scripts/regenerate_terminal_bench_scenarios.ts
 * @description Re-renders the scenario YAML for every already-ingested `external_terminal_bench`
 *   task from its vendored `task.json` (`ingest_terminal_bench.ts`'s field mapping, unchanged),
 *   without re-running classification or re-fetching the upstream Terminal-Bench source tree.
 *   Exists because `scenario_templates.ts`'s `renderExternalBenchTaskTemplate` is a pure
 *   function of task metadata plus the template itself — when the TEMPLATE changes (e.g. the
 *   GitHub issue #4 migration off raw `docker`/`shell` steps onto `run_jailed.ts`), every
 *   already-ingested task's persisted `.yaml` needs the same re-render, and doing that by
 *   re-running the full `ingest_terminal_bench.ts --batch` pipeline is both slower (re-classifies
 *   and re-vendors) and requires an upstream release checkout most environments don't have.
 * Usage:
 *   deno run -A scripts/regenerate_terminal_bench_scenarios.ts
 *     [--fixtures-dir <dir>] [--scenarios-dir <dir>] [--tool <tool>]
 * @dependencies [tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/schema/task_schema.ts]
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scenario_framework/scenarios/external_terminal_bench/]
 */

import { join } from "@std/path";
import { renderExternalBenchTaskTemplate } from "../tests/scenario_framework/runner/scenario_templates.ts";
import { type ITaskJson, TaskJsonSchema } from "../tests/scenario_framework/schema/task_schema.ts";

const DEFAULT_FIXTURES_DIR = "tests/scenario_framework/fixtures/external/terminal_bench";
const DEFAULT_SCENARIOS_DIR = "tests/scenario_framework/scenarios/external_terminal_bench";
/** Every currently-vendored task was (re-)ingested pinned to this tool (Phase 144 Step 5) —
 *  overridable via --tool for a future re-pin, but never silently guessed per task. */
const DEFAULT_TOOL = "opencode-go";

interface IRegenerateOptions {
  fixturesDir: string;
  scenariosDir: string;
  tool: string;
}

function parseArgs(argv: string[]): IRegenerateOptions {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) flags[arg.slice(2)] = argv[++i];
  }
  return {
    fixturesDir: flags["fixtures-dir"] ?? DEFAULT_FIXTURES_DIR,
    scenariosDir: flags["scenarios-dir"] ?? DEFAULT_SCENARIOS_DIR,
    tool: flags["tool"] ?? DEFAULT_TOOL,
  };
}

/** Builds the exact `IExternalBenchTaskTemplateOptions` `ingestOneBatchTask` would for
 *  `taskId`, reading its already-vendored `task.json` — the same field mapping, just without
 *  re-classifying or re-vendoring the task. */
async function loadTaskTemplateOptions(
  fixturesDir: string,
  taskId: string,
  tool: string,
): Promise<Parameters<typeof renderExternalBenchTaskTemplate>[0]> {
  const taskJsonPath = join(fixturesDir, taskId, "task.json");
  const taskJson: ITaskJson = TaskJsonSchema.parse(JSON.parse(await Deno.readTextFile(taskJsonPath)));
  if (!taskJson.source) {
    throw new Error(`${taskJsonPath}: missing "source" (benchmark provenance) — not a Terminal-Bench task`);
  }
  return {
    id: `external-terminal-bench-${taskId}`,
    title: taskJson.title ?? taskId,
    requestFixture: `fixtures/requests/external/terminal_bench/${taskId}.md`,
    portalDir: `external/terminal_bench/${taskId}`,
    scopedTestCmd: taskJson.scoped_test_cmd,
    oracleTestsDir: `${taskId}/oracle_tests`,
    tool,
    benchmarkVersion: taskJson.source.version,
  };
}

/**
 * Regenerates the scenario YAML for every `<task-id>.yaml` already present in `scenariosDir`
 * (the set of already-ingested, already-vendored tasks — never adds or removes a task).
 * Returns the regenerated task ids in the order processed.
 */
export async function regenerateTerminalBenchScenarios(options: IRegenerateOptions): Promise<string[]> {
  const taskIds: string[] = [];
  for await (const entry of Deno.readDir(options.scenariosDir)) {
    if (entry.isFile && entry.name.endsWith(".yaml")) {
      taskIds.push(entry.name.replace(/\.yaml$/, ""));
    }
  }
  taskIds.sort();

  for (const taskId of taskIds) {
    const templateOptions = await loadTaskTemplateOptions(options.fixturesDir, taskId, options.tool);
    const yaml = renderExternalBenchTaskTemplate(templateOptions);
    await Deno.writeTextFile(join(options.scenariosDir, `${taskId}.yaml`), yaml + "\n");
  }
  return taskIds;
}

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  const taskIds = await regenerateTerminalBenchScenarios(options);
  console.log(`Regenerated ${taskIds.length} scenario(s) in ${options.scenariosDir}:`);
  for (const taskId of taskIds) console.log(`  ${taskId}`);
}
