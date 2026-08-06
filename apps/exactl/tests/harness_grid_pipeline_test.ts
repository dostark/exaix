/**
 * @module HarnessGridPipelineTest
 * @path apps/exactl/tests/harness_grid_pipeline_test.ts
 * @description Phase 143 Step 6 — the CI guard: the harness-value grid pipeline runs
 *   end-to-end **token-free**. A scripted (shell) delegate task executes through the real
 *   synthetic runner, its history is written through the real eval-history chain, the five
 *   grid cell variants (Exaix, bare-delegate, and the three ablation cells) are attributed by
 *   `cell_id`, and all four report views (lift, ablation, frontier, failures) render on that
 *   history. Matrix scenarios require a `start-daemon` step (which cannot boot token-free in
 *   the synthetic env), so the grid variants are seeded into history as the plan's explicitly
 *   sanctioned "synthetic history" — the lift/ablation computations run on it exactly as they
 *   will on the live grid. The live grid run and founding tables are operator-triggered and
 *   deferred to the Reachability Ledger.
 * @architectural-layer CLI
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/history_writer_dispatch.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { ScenarioExecutionMode } from "../../../tests/scenario_framework/schema/step_schema.ts";
import { runSyntheticScenario } from "../../../tests/scenario_framework/runner/synthetic_runner.ts";
import { writeEvalHistoryEntries } from "../../../tests/scenario_framework/runner/history_writer_dispatch.ts";
import { VERIFY_TESTS_STEP_ID } from "../../../tests/scenario_framework/runner/scenario_templates.ts";
import {
  withSyntheticTestEnv,
  writeSyntheticScenario,
} from "../../../tests/scenario_framework/tests/integration/synthetic_test_helpers.ts";
import { SCHEMA_VERSION } from "../../../tests/scenario_framework/schema/version.ts";
import type { IRunManifest } from "../../../tests/scenario_framework/runner/evidence_collector.ts";
import type { IScenarioVerdict } from "../../../tests/scenario_framework/runner/scoring.ts";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  return Promise.resolve(result)
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

const GRID_STEPS = [
  {
    id: "setup-worktree",
    type: "shell",
    command: "sh",
    args: ["-c", `mkdir -p "$WORKSPACE_ROOT/worktree" && touch "$WORKSPACE_ROOT/worktree/fixed.txt"`],
    outputCriteriaLines: ['    - id: "worktree-ready"', '      kind: "command-exit-code"', "      equals: 0"],
  },
  {
    id: VERIFY_TESTS_STEP_ID,
    type: "shell",
    command: "sh",
    args: ["-c", `test -f "$WORKSPACE_ROOT/worktree/fixed.txt"`],
    outputCriteriaLines: ['    - id: "tests-pass"', '      kind: "command-exit-code"', "      equals: 0"],
  },
];

interface IGridVariant {
  label: string;
  cellId: string;
  tags: string[];
  score: number;
  failureClasses?: string[];
}

function makeVariant(overrides: Partial<IGridVariant> & { cellId: string }): IGridVariant {
  return {
    label: overrides.cellId,
    tags: ["task:bug-fix"],
    score: 1.0,
    ...overrides,
  };
}

function seedVariant(store: EvalSqliteStore, variant: IGridVariant): void {
  store.writeRun({
    run_id: `grid-${variant.cellId}`,
    scenario_id: "grid-task",
    pack: "synthetic",
    tags: variant.tags,
    outcome: variant.score >= 0.5 ? "success" : "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: variant.score,
    passed: variant.score >= 0.5,
    timestamp: new Date().toISOString(),
    cell_id: variant.cellId,
    provider: "anthropic",
    model: "claude-sonnet",
    ...(variant.failureClasses ? { failure_classes: variant.failureClasses } : {}),
  }, [{ stepId: VERIFY_TESTS_STEP_ID, score: variant.score }]);
}

Deno.test("[HarnessGridPipeline] the grid pipeline runs token-free, attributes the grid cells, and renders all four views", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const outputDir = join(tempDir, "grid-output");

  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot }) => {
    // 1. The scripted-delegate task runs token-free through the real runner.
    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "grid-task",
      tags: ["task:bug-fix", "grid"],
      schemaVersion: SCHEMA_VERSION,
      steps: GRID_STEPS,
    });
    const result = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });
    assertExists(result.manifest, "the scripted task must produce a manifest");
    assertEquals(result.manifest.outcome, "success");

    // 2. Write the run through the real eval-history chain.
    const manifests = new Map<string, IRunManifest>([["grid-task", result.manifest]]);
    const verdicts: IScenarioVerdict[] = [{
      scenarioId: "grid-task",
      pack: "synthetic",
      suiteScore: result.manifest.suite_score ?? 1.0,
      passed: true,
    }];
    await writeEvalHistoryEntries({
      manifests,
      scenarioVerdicts: verdicts,
      trialMetricsMap: new Map(),
      outputDir,
      historyFormat: "sqlite+jsonl",
      dbPath,
    });

    // 3. Seed the grid variants (the plan's sanctioned synthetic history): the Exaix cell, the
    //    bare-delegate cell, the three ablation cells, and one failing run with a failure class.
    const variants: IGridVariant[] = [
      makeVariant({ cellId: "grid-tool-anthropic", label: "exaix" }),
      makeVariant({ cellId: "bare/grid-tool/anthropic", label: "bare", tags: ["task:bug-fix", "harness:bare"] }),
      makeVariant({
        cellId: "ablate-skills/grid-tool/anthropic",
        label: "ablate-skills",
        tags: ["task:bug-fix", "ablate:skills"],
      }),
      makeVariant({
        cellId: "ablate-quality-gate/grid-tool/anthropic",
        label: "ablate-gate",
        tags: ["task:bug-fix", "ablate:quality-gate"],
      }),
      makeVariant({
        cellId: "ablate-portal-knowledge/grid-tool/anthropic",
        label: "ablate-pk",
        tags: ["task:bug-fix", "ablate:portal-knowledge"],
      }),
      makeVariant({
        cellId: "grid-tool-anthropic",
        label: "failing",
        score: 0.4,
        failureClasses: ["execution.failed"],
      }),
    ];
    const store = new EvalSqliteStore(dbPath);
    try {
      for (const variant of variants) seedVariant(store, variant);

      // 4. History attribution: every grid cell recorded its cell_id.
      const rows = store.queryRuns({});
      const cellIds = new Set(rows.map((r) => r.cell_id));
      for (
        const cellId of [
          "grid-tool-anthropic",
          "bare/grid-tool/anthropic",
          "ablate-skills/grid-tool/anthropic",
          "ablate-quality-gate/grid-tool/anthropic",
          "ablate-portal-knowledge/grid-tool/anthropic",
        ]
      ) {
        assert(cellIds.has(cellId), `history must attribute cell ${cellId}`);
      }
    } finally {
      store.close();
    }

    // 5. All four report views render on the grid history (token-free).
    const cmds = new EvalCommands(context);
    const views: Array<{ view: string; expect: string[] }> = [
      { view: "lift", expect: ["Harness Lift", "grid-tool-anthropic", "bare/grid-tool/anthropic"] },
      { view: "ablation", expect: ["Ablation", "skills", "quality-gate", "portal-knowledge"] },
      { view: "frontier", expect: ["Accuracy vs Cost", "grid-tool-anthropic", "bare/grid-tool/anthropic"] },
      { view: "failures", expect: ["Failure Classes", "execution.failed"] },
    ];
    for (const { view, expect } of views) {
      const { output } = await withCapturedOutput(() => cmds.report({ view, dbPath }));
      const text = output.join("\n");
      assert(text.length > 0 && !text.includes("Error"), `${view} view must render without error`);
      for (const needle of expect) {
        assertStringIncludes(text, needle, `${view} view must render ${needle}`);
      }
    }
  });

  await cleanup();
});
