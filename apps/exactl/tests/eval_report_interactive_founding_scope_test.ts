/**
 * @module EvalReportInteractiveFoundingScopeTest
 * @path apps/exactl/tests/eval_report_interactive_founding_scope_test.ts
 * @description Phase 145 post-gap remediation Step 7 (GAP-1) — `computeInteractiveRows`'s
 *   `runIds` option scopes the rendered per-persona table to an explicit run-id allowlist, so a
 *   documented founding table can be regenerated exactly regardless of how much further local
 *   run history has accumulated in the shared `.exa/eval.db` by the time it's re-run.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { computeInteractiveRows, EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

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

function interactiveTags(persona: string, rounds: number, converged: boolean, adherent: boolean): string[] {
  return ["interactive", `persona:${persona}`, `rounds:${rounds}`, `converged:${converged}`, `adherent:${adherent}`];
}

Deno.test("[EvalReportInteractiveFoundingScope] runIds allowlist excludes runs added after the founding set", () => {
  const rows = computeInteractiveRows(
    [
      {
        run_id: "founding-1",
        tags: JSON.stringify(interactiveTags("cooperative", 2, true, true)),
        pass_pow_k: 1.0,
      },
      {
        run_id: "founding-2",
        tags: JSON.stringify(interactiveTags("cooperative", 2, true, true)),
        pass_pow_k: 1.0,
      },
      // A later, unrelated run for the same persona — must not shift the scoped mean.
      {
        run_id: "later-debug-attempt",
        tags: JSON.stringify(interactiveTags("cooperative", 8, false, true)),
        pass_pow_k: 0.0,
      },
    ],
    { runIds: ["founding-1", "founding-2"] },
  );
  const cooperative = rows.find((r) => r.persona === "cooperative")!;
  assertEquals(cooperative.runCount, 2);
  assertEquals(cooperative.meanRoundsToConverge, 2, "the later noise run's rounds must not shift the scoped mean");
});

Deno.test("[EvalReportInteractiveFoundingScope] omitting runIds keeps prior unscoped behavior unchanged", () => {
  const runs = [
    { run_id: "a", tags: JSON.stringify(interactiveTags("cooperative", 2, true, true)), pass_pow_k: 1.0 },
    { run_id: "b", tags: JSON.stringify(interactiveTags("cooperative", 4, true, true)), pass_pow_k: 0.8 },
  ];
  const scoped = computeInteractiveRows(runs, {});
  const unscopedCall = computeInteractiveRows(runs);
  assertEquals(scoped, unscopedCall);
  assertEquals(scoped[0].meanRoundsToConverge, 3);
});

Deno.test("[EvalReportInteractiveFoundingScope] --view interactive --run-ids renders only the scoped runs", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  const seed = (runId: string, rounds: number) =>
    store.writeRun({
      run_id: runId,
      scenario_id: "interactive-cooperative",
      pack: "interactive",
      tags: interactiveTags("cooperative", rounds, true, true),
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1.0,
      passed: true,
      timestamp: new Date().toISOString(),
      pass_pow_k: 1.0,
    }, []);
  seed("founding-1", 2);
  seed("later-debug-attempt", 8);
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() =>
    cmds.report({ view: "interactive", dbPath, runIds: ["founding-1"] })
  );
  const text = output.join("\n");
  assertStringIncludes(text, "cooperative");
  assertStringIncludes(text, "2.000");
  assertEquals(text.includes("8.000"), false, "the later noise run must not appear in the scoped table");
  await cleanup();
});
