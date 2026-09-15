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
import { fromFileUrl, join, resolve } from "@std/path";
import { EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR } from "@exaix/request";
import {
  buildPersonaComparisonInput,
  buildPersonaIsolationArmPlan,
  type IPersonaIsolationArmPlan,
  type IPersonaIsolationRunResult,
  materializePersonaVariants,
  type PersonaVariant,
} from "../tests/scenario_framework/runner/persona_isolation_arm.ts";
import { loadScenarioCatalog } from "../tests/scenario_framework/runner/scenario_catalog.ts";

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
  runnerCell: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  sourceBlueprintAlias: z.string().startsWith("@"),
  overlayRootAlias: z.string().startsWith("@"),
  reportOutputAlias: z.string().startsWith("@"),
}).strict();

type PersonaIsolationManifest = z.infer<typeof PersonaIsolationManifestSchema>;
const SCENARIO_FRAMEWORK_ROOT = resolve(fromFileUrl(new URL("../tests/scenario_framework", import.meta.url)));

/** Runs a validated manifest, or plans the complete path without spawning in dry-run mode. */
export async function runPersonaIsolation(
  manifest: PersonaIsolationManifest,
  dryRun: boolean,
): Promise<IPersonaOperatorOutput> {
  const resolver = new PathResolver(manifest.config);
  const plan = await buildPersonaIsolationArmPlan(manifest, resolver);
  await validateScenarioCatalog(plan.scenarioIds);
  const reportOutputPath = await resolver.resolve(manifest.reportOutputAlias);
  const generatedRoot = join(plan.overlayRoot, plan.agentRoleId);

  try {
    await materializePersonaVariants(plan);
    const executionPlan = buildExecutionPlan(plan, manifest.runnerCell, dryRun);
    await runCells(executionPlan);
    const results = dryRun ? buildDryRunResults(plan) : await readResults(plan, executionPlan);
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

async function validateScenarioCatalog(scenarioIds: string[]): Promise<void> {
  const catalog = await loadScenarioCatalog({ frameworkHome: SCENARIO_FRAMEWORK_ROOT });
  const knownIds = new Set(catalog.map((entry) => entry.id));
  if (scenarioIds.some((id) => !knownIds.has(id))) {
    throw new Error("Persona isolation manifest contains an unknown scenario id");
  }
}

function buildExecutionPlan(
  plan: IPersonaIsolationArmPlan,
  runnerCell: string,
  dryRun: boolean,
): IPersonaExecutionCell[] {
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
      runnerCell,
      ...cell.scenarioIds.flatMap((scenarioId) => ["--scenario", scenarioId]),
    ];
    if (dryRun) argv.push("--dry-run");
    return {
      variant: cell.variant,
      argv,
      env: {
        [EXA_EVAL_AGENT_ROLE_OVERLAY_DIR_ENV_VAR]: cell.overlayDir,
        EXA_LLM_PROVIDER: cell.provider,
        // Colon-joined "provider:model", matching run_judge_calibration_live_probe.ts's
        // established convention — a bare model name reaches ModelResolver's
        // tryResolveBareName(), which only succeeds when the bare name is itself a
        // registered provider id, so a real model name (e.g. "claude-sonnet-5") throws
        // "Unknown model" for the judge-quality LLM call.
        EXA_LLM_MODEL: `${cell.provider}:${cell.model}`,
      },
      outputDir,
    };
  });
}

async function runCells(cells: IPersonaExecutionCell[]): Promise<void> {
  for (const cell of cells) {
    const command = new Deno.Command(Deno.execPath(), {
      args: cell.argv,
      env: cell.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await command.spawn().status;
    if (!status.success) throw new Error("Persona scenario cell failed");
  }
}

async function readResults(
  plan: IPersonaIsolationArmPlan,
  cells: IPersonaExecutionCell[],
): Promise<IPersonaIsolationRunResult[]> {
  const results: IPersonaIsolationRunResult[] = [];
  for (const cell of cells) results.push(await readCellResults(plan, cell));
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
