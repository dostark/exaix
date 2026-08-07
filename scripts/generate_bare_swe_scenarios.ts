#!/usr/bin/env -S deno run -A
/**
 * @module GenerateBareSweScenarios
 * @path scripts/generate_bare_swe_scenarios.ts
 * @description Renders the bare-delegate baseline scenarios for the two Phase 143 harness-lift
 *   swe_tasks (async-ordering-bug, path-traversal-storage) via renderSweTaskBareTemplate, so a
 *   live operator can run the Exaix-vs-bare comparison in the Docker eval-jail.
 *   Usage: deno run -A scripts/generate_bare_swe_scenarios.ts
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { renderSweTaskBareTemplate } from "../tests/scenario_framework/runner/scenario_templates.ts";

const OUT_DIR = new URL("../tests/scenario_framework/scenarios/swe_tasks/", import.meta.url);

const TASKS = [
  {
    id: "bare-swe-async-ordering-bug",
    title: "Bare delegate baseline — Fix async ordering (processBatchSubmissions in-flight duplicates)",
    requestFixture: "fixtures/requests/swe_tasks/async-ordering-bug.md",
    portal: "todo_app_async_bug",
  },
  {
    id: "bare-swe-path-traversal-storage",
    title: "Bare delegate baseline — Fix path traversal in TaskRepository.importFromFile",
    requestFixture: "fixtures/requests/swe_tasks/path-traversal-storage.md",
    portal: "todo_app_path_traversal",
  },
  {
    id: "bare-swe-fix-bug-null-guard",
    title: "Bare delegate baseline — Fix null-pointer crash in addTask",
    requestFixture: "fixtures/requests/swe_tasks/fix-bug-null-guard.md",
    portal: "todo_app_null_guard_bug",
  },
  {
    id: "bare-swe-injection-sanitisation",
    title: "Bare delegate baseline — Sanitise task descriptions before rendering",
    requestFixture: "fixtures/requests/swe_tasks/injection-sanitisation.md",
    portal: "todo_app_injection",
  },
  {
    id: "bare-swe-refactor-extract-function",
    title: "Bare delegate baseline — Extract sort utility from task list rendering",
    requestFixture: "fixtures/requests/swe_tasks/refactor-extract-function.md",
    portal: "todo_app",
  },
  {
    id: "bare-swe-add-feature-endpoint",
    title: "Bare delegate baseline — Add a search feature endpoint",
    requestFixture: "fixtures/requests/swe_tasks/add-feature-endpoint.md",
    portal: "todo_app",
  },
];

const CELLS = [
  { tool: "claude-code", provider: "claude-cli", config: "configs/claude-cli-delegate-all.toml", requiresBin: "claude" },
  { tool: "claude-haiku-4-5", provider: "claude-cli", config: "configs/claude-haiku-4-5-delegate-all.toml", requiresBin: "claude" },
];

for (const task of TASKS) {
  const yaml = renderSweTaskBareTemplate({
    id: task.id,
    title: task.title,
    requestFixture: task.requestFixture,
    portal: task.portal,
    cells: CELLS,
  });
  const path = new URL(`${task.id}.yaml`, OUT_DIR);
  await Deno.writeTextFile(path, yaml + "\n");
  console.log(`wrote ${path.pathname}`);
}
