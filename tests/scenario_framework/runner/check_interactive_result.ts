#!/usr/bin/env -S deno run -A
/**
 * @module CheckInteractiveResult
 * @path tests/scenario_framework/runner/check_interactive_result.ts
 * @description CLI entrypoint wired into an interactive-pack live scenario as the recording
 *   step: reads a real `exactl request clarify --json` result and any real wait states it
 *   resolved, computes rounds/converged/adherent, and seeds them into eval-history — the same
 *   values `interactive_pipeline_test.ts` computes in-process, now over real live values instead
 *   of a scripted `MockLLMProvider`.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/policy_adherence.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { checkRunAdherence, type IPolicyAdherenceWaitState } from "./policy_adherence.ts";

const USAGE =
  "usage: check_interactive_result.ts <clarifyResultPath> <waitStateDir> <expectedResolvedBy> <persona> <dbPath>";

interface IClarifyResultFile {
  status: string;
  round?: number;
}

async function readWaitStates(waitStateDir: string): Promise<IPolicyAdherenceWaitState[]> {
  const waitStates: IPolicyAdherenceWaitState[] = [];
  try {
    for await (const entry of Deno.readDir(waitStateDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        const raw = await Deno.readTextFile(join(waitStateDir, entry.name));
        waitStates.push(JSON.parse(raw) as IPolicyAdherenceWaitState);
      } catch {
        continue;
      }
    }
  } catch {
    // wait-state directory may not exist — no wait states were ever created
  }
  return waitStates;
}

export async function main(args: string[]): Promise<number> {
  const [clarifyResultPath, waitStateDir, expectedResolvedBy, persona, dbPath] = args;
  if (!clarifyResultPath || !waitStateDir || !expectedResolvedBy || !persona || !dbPath) {
    console.error(USAGE);
    return 2;
  }

  const clarifyResult = JSON.parse(await Deno.readTextFile(clarifyResultPath)) as IClarifyResultFile;
  const converged = clarifyResult.status === "complete";
  const rounds = clarifyResult.round ?? 1;

  const waitStates = await readWaitStates(waitStateDir);
  const adherenceResult = checkRunAdherence(waitStates, expectedResolvedBy);

  const store = new EvalSqliteStore(dbPath);
  try {
    store.writeRun({
      run_id: crypto.randomUUID(),
      scenario_id: `interactive-${persona}-live`,
      pack: "interactive",
      tags: [
        "interactive",
        `persona:${persona}`,
        `rounds:${rounds}`,
        `converged:${converged}`,
        `adherent:${adherenceResult.adherent}`,
      ],
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1.0,
      passed: true,
      timestamp: new Date().toISOString(),
      pass_pow_k: 1.0,
    }, []);
  } finally {
    store.close();
  }

  console.log(JSON.stringify({ rounds, converged, adherent: adherenceResult.adherent }));
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
