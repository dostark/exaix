/**
 * @module ScenarioFrameworkEvidenceCollector
 * @path tests/scenario_framework/runner/evidence_collector.ts
 * @description Implements Step 5 evidence copy helpers and run
 * manifest persistence with a deterministic output path.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/tests/unit/assertions_evidence_test.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { dirname, isAbsolute, resolve } from "@std/path";
import type { ICriterionResult, IScenarioStep } from "../schema/step_schema.ts";
import type { IScenarioStepOutcome } from "./assertions.ts";
import type { IArmComparisonSpec } from "./arm_comparison.ts";
import type { IMechanicsEvidence } from "./validity_gate.ts";
import type { ScoringMode } from "./scoring.ts";

export interface ICopyEvidenceArtifactOptions {
  outputDir: string;
  sourcePath: string;
  relativeDestinationPath: string;
}

export interface IRunManifestStepTokens {
  prompt: number;
  completion: number;
  cacheRead?: number;
  cacheCreation?: number;
  total: number;
}

export interface IRunManifestStep {
  stepId: string;
  stepType: IScenarioStep["type"];
  executionStatus: string;
  criterionResults: ICriterionResult[];
  score?: number;
  /** Runner-observed wall-clock duration for this step, ms. Phase 140a Step 1. */
  durationMs?: number;
  /** Sum of journaled LLM call duration(s) in this step's rowid window, ms. Phase 140a Step 3. */
  llmDurationMs?: number;
  /** Token breakdown summed from this step's journaled LLM calls. Phase 140a Step 3. */
  tokens?: IRunManifestStepTokens;
  /** Real tracked cost (cost_source: "tracked" journal rows only) for this step. Phase 140a Step 3. */
  trackedCostUsd?: number;
}

export interface IRunManifest {
  scenarioId: string;
  pack: string;
  mode: string;
  outcome: string;
  steps: IRunManifestStep[];
  suite_score?: number;
  /** The scoring mode the run was computed under (Phase 143 Step 3). Absent ⇒ additive. */
  scoringMode?: ScoringMode;
  /** The run's failure classes (Phase 143 Step 5) — joined from its journal trace at
   *  history-write time; absent ⇒ no failures classified. */
  failureClasses?: string[];
  cellId?: string;
  provider?: string;
  model?: string;
  /** Task-family tags propagated to eval history. Phase 141 Step 1. */
  tags?: string[];
  /** The pre-registered arm-comparison declaration this run measures against, when the
   *  run is part of Phase 158's value-evaluation tier. Absent for ordinary mechanics runs. */
  armComparison?: IArmComparisonSpec;
  /** The Phase 142 mechanics evidence that admitted this value run through Step 3's
   *  validity gate, kept distinct from `armComparison` so a later reader can tell "the
   *  artefact ran" (mechanics) apart from "the artefact helped" (value). Absent for
   *  ordinary mechanics runs. */
  mechanicsEvidence?: IMechanicsEvidence;
}

export interface IWriteRunManifestOptions {
  outputDir: string;
  manifest: IRunManifest;
}

export interface IWriteExecutionLogOptions {
  outputDir: string;
  scenarioId: string;
  stepOutcomes: IScenarioStepOutcome[];
}

const RUN_MANIFEST_FILE = "run-manifest.json";

export async function copyEvidenceArtifact(
  options: ICopyEvidenceArtifactOptions,
): Promise<string> {
  if (isAbsolute(options.relativeDestinationPath)) {
    throw new Error("evidence destination path must be relative");
  }

  const outputDir = resolve(options.outputDir);
  const destinationPath = resolve(outputDir, options.relativeDestinationPath);
  const allowedPrefix = `${outputDir}/`;

  if (destinationPath !== outputDir && !destinationPath.startsWith(allowedPrefix)) {
    throw new Error("evidence destination path escapes output directory");
  }

  await Deno.mkdir(dirname(destinationPath), { recursive: true });
  await Deno.copyFile(resolve(options.sourcePath), destinationPath);
  return options.relativeDestinationPath;
}

export async function writeRunManifest(
  options: IWriteRunManifestOptions,
): Promise<string> {
  const outputDir = resolve(options.outputDir);
  await Deno.mkdir(outputDir, { recursive: true });

  const manifestPath = resolve(outputDir, RUN_MANIFEST_FILE);
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(options.manifest, null, 2)}\n`,
  );

  return manifestPath;
}

export async function writeExecutionLog(
  options: IWriteExecutionLogOptions,
): Promise<string> {
  const outputDir = resolve(options.outputDir);
  await Deno.mkdir(outputDir, { recursive: true });

  const logLines: string[] = [];
  logLines.push(`SCENARIO EXECUTION LOG: ${options.scenarioId}`);
  logLines.push(`Generated: ${new Date().toISOString()}`);
  logLines.push("=".repeat(80));

  for (const outcome of options.stepOutcomes) {
    const res = outcome.executionResult;
    logLines.push(`\nSTEP: ${outcome.stepId}`);
    logLines.push(`Status: ${outcome.status}`);

    if (res) {
      logLines.push(`Step Type: ${res.stepType}`);
      logLines.push(`Started At: ${res.startedAt}`);
      logLines.push(`Duration: ${res.durationMs}ms`);
      logLines.push(`Exit Code: ${res.exitCode}`);

      if (res.stdout.trim()) {
        logLines.push("\n--- STDOUT ---");
        logLines.push(res.stdout.trim());
      }

      if (res.stderr.trim()) {
        logLines.push("\n--- STDERR ---");
        logLines.push(res.stderr.trim());
      }
    } else {
      logLines.push("No execution data (criteria-only step)");
    }

    logLines.push("-".repeat(40));
  }

  const logPath = resolve(outputDir, "scenario-execution.log");
  await Deno.writeTextFile(logPath, `${logLines.join("\n")}\n`);
  return logPath;
}
