/**
 * @module MemoryPipelineTest
 * @path tests/scenario_framework/tests/integration/memory_pipeline_test.ts
 * @description Phase 148 Step 6's CI guard: runs the full deterministic memory-eval grid
 * (every `pack: memory` scenario except `multi-session-reasoning-basic`, which needs a
 * live/mocked llm-judge and belongs to the gated cadence, not ci-core) through the real
 * `main.ts` runner with `--eval-mode`, into a scratch eval-history db, then asserts
 * `eval report --view memory` renders every metric family (abilities AND the
 * consolidation-quality/staleness/learning-effectiveness metric table) from that real
 * history with zero tokens recorded anywhere in the grid — proving the ci-core tier is
 * genuinely token-free, not just documented as such.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../../../../apps/exactl/src/commands/eval_commands.ts";
import { createCliTestContext } from "../../../../apps/exactl/tests/helpers/test_setup.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");
const MAIN_TS = join(REPO_ROOT, "tests", "scenario_framework", "runner", "main.ts");

/** Every ci-core (deterministic, no LLM) `pack: memory` scenario. Deliberately excludes
 * `memory-multi-session-reasoning-basic`, whose llm-judge criterion belongs to the gated
 * cadence per this step's Actions ("judge/live behind the gated (nightly/manual) cadence"). */
const DETERMINISTIC_MEMORY_SCENARIO_IDS = [
  "memory-info-extraction-basic",
  "memory-temporal-reasoning-basic",
  "memory-knowledge-updates-basic",
  "memory-abstention-basic",
  "memory-consolidation-quality-basic",
  "memory-staleness-basic",
  "memory-learning-effectiveness-basic",
];

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

async function runScenario(scenarioId: string, dbPath: string): Promise<void> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", MAIN_TS, "-s", scenarioId, "--eval-mode"],
    cwd: REPO_ROOT,
    env: { EXA_EVAL_DB_PATH: dbPath },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  assertEquals(
    code,
    0,
    `${scenarioId} failed (exit ${code}):\n${new TextDecoder().decode(stdout)}\n${new TextDecoder().decode(stderr)}`,
  );
}

Deno.test({
  name:
    "[MemoryPipeline] the full deterministic memory grid runs, persists, and renders every metric family token-free",
  fn: async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "memory-pipeline-" });
    const dbPath = join(tempDir, "eval.db");
    try {
      for (const scenarioId of DETERMINISTIC_MEMORY_SCENARIO_IDS) {
        await runScenario(scenarioId, dbPath);
      }

      const store = new EvalSqliteStore(dbPath);
      let runs: Array<{ total_tokens_prompt: number | null; total_tokens_completion: number | null }>;
      try {
        store.initialize();
        runs = store["db"].prepare(
          "SELECT total_tokens_prompt, total_tokens_completion FROM eval_runs WHERE pack = 'memory'",
        ).all<{ total_tokens_prompt: number | null; total_tokens_completion: number | null }>();
      } finally {
        store.close();
      }

      assertEquals(runs.length, DETERMINISTIC_MEMORY_SCENARIO_IDS.length);
      for (const run of runs) {
        assert(
          run.total_tokens_prompt == null && run.total_tokens_completion == null,
          `expected zero tokens recorded for the ci-core memory grid, got prompt=${run.total_tokens_prompt} completion=${run.total_tokens_completion}`,
        );
      }

      const { context, cleanup } = await createCliTestContext();
      try {
        const cmds = new EvalCommands(context);
        const { output } = await withCapturedOutput(() => cmds.report({ view: "memory", dbPath }));
        const text = output.join("\n");
        assertStringIncludes(text, "information-extraction");
        assertStringIncludes(text, "temporal-reasoning");
        assertStringIncludes(text, "knowledge-updates");
        assertStringIncludes(text, "abstention");
        assertStringIncludes(text, "Consolidation & Learning-Effectiveness");
        assertStringIncludes(text, "consolidation-quality");
        assertStringIncludes(text, "staleness");
        assertStringIncludes(text, "learning-effectiveness");
      } finally {
        await cleanup();
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
