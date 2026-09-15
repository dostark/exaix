#!/usr/bin/env -S deno run -A

/**
 * @module RunPersonaIsolation
 * @path scripts/run_persona_isolation.ts
 * Usage: deno run -A scripts/run_persona_isolation.ts [--dry-run] <manifest.json>
 * @description Operator entry point for validated persona-isolation scenario arms.
 * @architectural-layer Script
 * @dependencies [tests/scenario_framework/runner/persona_isolation_arm.ts, tests/scenario_framework/runner/main.ts, scripts/run_value_comparison_report.ts]
 * @related-files [tests/scenario_framework/tests/integration/persona_isolation_runner_integration_test.ts]
 */

import { z } from "zod";
import { ConfigSchema } from "@exaix/schemas";
import { PathResolver } from "@exaix/portal";
import { join } from "@std/path";
import { EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";
import {
  buildPersonaComparisonInput,
  buildPersonaIsolationArmPlan,
  type IPersonaIsolationArmPlan,
  type IPersonaIsolationRunResult,
  materializePersonaVariants,
  type PersonaVariant,
} from "../tests/scenario_framework/runner/persona_isolation_arm.ts";

export interface IPersonaExecutionCell {
  variant: PersonaVariant;
  argv: string[];
  env: { EXA_EVAL_AGENT_ROLE_OVERLAY_DIR: string; EXA_LLM_PROVIDER: string; EXA_LLM_MODEL: string };
  outputDir: string;
}

export interface IPersonaOperatorOutput {
  armComparisons: ReturnType<typeof buildPersonaComparisonInput>["armComparisons"];
  basisRunIds: string[];
  executionPlan: IPersonaExecutionCell[];
}

const PersonaIsolationManifestSchema = z.object({
  config: ConfigSchema,
  agentRoleId: z.string().min(1),
  scenarioIds: z.array(z.string().min(1)).min(2),
  trials: z.number().int().min(3),
  provider: z.string().min(1),
  model: z.string().min(1),
  sourceBlueprintAlias: z.string().startsWith("@"),
  overlayRootAlias: z.string().startsWith("@"),
  reportOutputAlias: z.string().startsWith("@"),
}).strict();

type PersonaIsolationManifest = z.infer<typeof PersonaIsolationManifestSchema>;

/** Runs a validated manifest, or plans the complete path without spawning in dry-run mode. */
export async function runPersonaIsolation(
  manifest: PersonaIsolationManifest,
  dryRun: boolean,
): Promise<IPersonaOperatorOutput> {
  const resolver = new PathResolver(manifest.config);
  const plan = await buildPersonaIsolationArmPlan(manifest, resolver);
  const reportOutputPath = await resolver.resolve(manifest.reportOutputAlias);
  const generatedRoot = join(plan.overlayRoot, plan.agentRoleId);

  try {
    await materializePersonaVariants(plan);
    const executionPlan = buildExecutionPlan(plan, dryRun);
    const results = dryRun ? buildDryRunResults(plan) : await executeCells(plan, executionPlan);
    const report = buildPersonaComparisonInput(plan, results);
    const output = { ...report, executionPlan };
    await Deno.writeTextFile(reportOutputPath, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  } finally {
    await Deno.remove(generatedRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

function buildExecutionPlan(plan: IPersonaIsolationArmPlan, dryRun: boolean): IPersonaExecutionCell[] {
  return plan.cells.map((cell) => {
    const outputDir = join(cell.overlayDir, "run-output");
    const argv = [
      "run",
      "-A",
      "tests/scenario_framework/runner/main.ts",
      "--eval-mode",
      "--trials",
      String(cell.trials),
      "--output",
      outputDir,
      "--cell",
      cell.provider,
      ...cell.scenarioIds.flatMap((scenarioId) => ["--scenario", scenarioId]),
    ];
    if (dryRun) argv.push("--dry-run");
    return {
      variant: cell.variant,
      argv,
      env: {
        [EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR]: cell.overlayDir,
        EXA_LLM_PROVIDER: cell.provider,
        EXA_LLM_MODEL: cell.model,
      },
      outputDir,
    };
  });
}

async function executeCells(
  plan: IPersonaIsolationArmPlan,
  cells: IPersonaExecutionCell[],
): Promise<IPersonaIsolationRunResult[]> {
  const results: IPersonaIsolationRunResult[] = [];
  for (const cell of cells) {
    const command = new Deno.Command(Deno.execPath(), {
      args: cell.argv,
      env: cell.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await command.spawn().status;
    if (!status.success) throw new Error("Persona scenario cell failed");
    results.push(await readCellResults(plan, cell));
  }
  return results;
}

async function readCellResults(
  plan: IPersonaIsolationArmPlan,
  cell: IPersonaExecutionCell,
): Promise<IPersonaIsolationRunResult> {
  const text = await Deno.readTextFile(join(cell.outputDir, "history", "eval-history.jsonl"));
  const entries = text.trim().split("\n").map((line) =>
    z.object({
      run_id: z.string().min(1),
      scenario_id: z.string().min(1),
      trial_scores: z.array(z.number()),
      provider: z.string().optional(),
      model: z.string().optional(),
    }).passthrough().parse(JSON.parse(line))
  );
  return {
    variant: cell.variant,
    provider: plan.provider,
    model: plan.model,
    tasks: plan.scenarioIds.map((taskId) => {
      const entry = entries.find((candidate) => candidate.scenario_id === taskId);
      if (!entry || entry.provider && entry.provider !== plan.provider || entry?.model && entry.model !== plan.model) {
        throw new Error("Persona run provenance is missing or drifted");
      }
      return { taskId, scores: entry.trial_scores, runManifestIds: [entry.run_id] };
    }),
  };
}

function buildDryRunResults(plan: IPersonaIsolationArmPlan): IPersonaIsolationRunResult[] {
  return plan.cells.map((cell) => ({
    variant: cell.variant,
    provider: cell.provider,
    model: cell.model,
    tasks: cell.scenarioIds.map((taskId) => ({
      taskId,
      scores: Array.from({ length: cell.trials }, () => 0),
      runManifestIds: [`dry-run:${cell.variant}:${taskId}`],
    })),
  }));
}

async function main(args: string[]): Promise<void> {
  const dryRun = args[0] === "--dry-run";
  const manifestPath = dryRun ? args[1] : args[0];
  if (!manifestPath || args.length !== (dryRun ? 2 : 1)) {
    throw new Error("Usage: run_persona_isolation.ts [--dry-run] <manifest.json>");
  }
  const parsed = PersonaIsolationManifestSchema.parse(JSON.parse(await Deno.readTextFile(manifestPath)));
  await runPersonaIsolation(parsed, dryRun);
}

if (import.meta.main) await main(Deno.args);
