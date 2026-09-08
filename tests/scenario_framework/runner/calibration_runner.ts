/**
 * @module ScenarioFrameworkCalibrationRunner
 * @path tests/scenario_framework/runner/calibration_runner.ts
 * @description Phase 146 Step 1's calibration orchestrator: reads a seeded real-artifact
 *   selection, scores each item with the target judge AND a cross-provider reference
 *   evaluator, and computes judge-reference agreement — via injected `{ judge, reference,
 *   sourceReader, store, clock }` adapters (plan Ownership contract), so the orchestration
 *   logic is testable without any live call while the real adapters remain genuinely live.
 *   No independent scorer/prompt path: both scoring adapters delegate to
 *   assertions.ts/calibration_reference.ts, the same code the live judge/reference calls use.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_sources.ts, tests/scenario_framework/runner/calibration_reference.ts, tests/scenario_framework/runner/assertions.ts, packages/eval-history/src/calibration/metrics.ts]
 */

import { resolve } from "@std/path";
import {
  alignCalibrationPairs,
  CalibrationMetricError,
  computeCohenKappa,
  computeExactAgreement,
  computeIntervalAlpha,
  deriveCalibrationLabel,
} from "@exaix/eval-history";
import type { CalibrationLabel, ICalibrationRubric, IMetricResult } from "@exaix/eval-history";
import {
  DomainEventType,
  type ICalibrationFailedPayload,
  type ICalibrationReferenceCompletedPayload,
  type ICalibrationScoredPayload,
  type ICalibrationStartedPayload,
} from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../schema/step_schema.ts";
import { evaluateLlmJudgeCriterion, type ICalibrationCaptureMetadata } from "./assertions.ts";
import { evaluateReference } from "./calibration_reference.ts";
import {
  type ICalibrationSourceItem,
  type ICalibrationSourceSelection,
  type IReadCalibrationSourcesOptions,
  readCalibrationSources,
} from "./calibration_sources.ts";

export interface ICalibrationVendorTarget {
  readonly provider: string;
  readonly model: string;
}

export interface IJudgeScoreResult {
  readonly score: number;
  readonly provider: string;
  readonly model: string;
}

export interface ICalibrationJudgeAdapter {
  score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult>;
}

export interface ICalibrationReferenceAdapter {
  score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult>;
}

export interface ICalibrationSourceReaderAdapter {
  read(options: IReadCalibrationSourcesOptions): Promise<ICalibrationSourceSelection>;
}

export interface ICalibrationRunItem {
  readonly id: string;
  readonly targetScore: number;
  readonly referenceScore: number;
  readonly targetLabel: CalibrationLabel;
  readonly referenceLabel: CalibrationLabel;
}

export interface ICalibrationRunResult {
  readonly runId: string;
  readonly generatedAt: string;
  readonly targetProvenance: ICalibrationVendorTarget;
  readonly referenceProvenance: ICalibrationVendorTarget;
  readonly items: ICalibrationRunItem[];
  readonly metrics: { exact: IMetricResult; kappa: IMetricResult; alpha: IMetricResult };
  readonly sampleCount: number;
  readonly excludedCount: number;
  readonly realExecutionMarker: true;
}

export interface ICalibrationStoreAdapter {
  write(result: ICalibrationRunResult): Promise<string>;
}

export interface ICalibrationClock {
  now(): Date;
}

export interface ICalibrationRunnerAdapters {
  readonly judge: ICalibrationJudgeAdapter;
  readonly reference: ICalibrationReferenceAdapter;
  readonly sourceReader: ICalibrationSourceReaderAdapter;
  readonly store: ICalibrationStoreAdapter;
  readonly clock: ICalibrationClock;
  /** Absent in most unit tests (mock adapters); the production composition root
   *  (scripts/run_judge_calibration.ts) always injects a real one. */
  readonly logger?: Opt<IEventLogger, Reason.OptionalDependency>;
}

export interface ICalibrationRunOptions {
  readonly sourceIndexPath: string;
  readonly snapshotRoot: string;
  readonly seed: string;
  readonly sampleCount: number;
  readonly rubric: ICalibrationRubric;
  readonly target: ICalibrationVendorTarget;
  readonly reference: ICalibrationVendorTarget;
}

export class CalibrationRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationRunnerError";
  }
}

type CalibrationRunOperation = "read" | "judge" | "reference" | "store";

function classifyCalibrationErrorCode(error: Error): string {
  if (error instanceof CalibrationRunnerError) return "calibration-runner-error";
  if (error instanceof CalibrationMetricError) return "calibration-metric-error";
  return "unexpected-error";
}

/** Orchestrates one calibration run: read → score (target + reference) → agree. Every
 *  dependency is injected so the sequencing here is testable with mock adapters; the
 *  real adapters below are what production wires in. */
export class CalibrationRunner {
  constructor(private readonly adapters: ICalibrationRunnerAdapters) {}

  async run(options: ICalibrationRunOptions): Promise<ICalibrationRunResult> {
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    let operation: CalibrationRunOperation = "read";

    await this.adapters.logger?.info(
      DomainEventType.CalibrationStarted,
      null,
      {
        run_id: runId,
        seed: options.seed,
        sample_count: options.sampleCount,
        target_vendor: options.target.provider,
        reference_vendor: options.reference.provider,
      } satisfies ICalibrationStartedPayload,
      runId,
    );

    try {
      const selection = await this.adapters.sourceReader.read({
        sourceIndexPath: options.sourceIndexPath,
        snapshotRoot: options.snapshotRoot,
        seed: options.seed,
        sampleCount: options.sampleCount,
      });

      const items: ICalibrationRunItem[] = [];
      for (const sourceItem of selection.selected) {
        operation = "judge";
        const target = await this.adapters.judge.score(sourceItem, options.rubric, options.target);
        operation = "reference";
        const referenceStartedAt = Date.now();
        const reference = await this.adapters.reference.score(sourceItem, options.rubric, options.reference);
        await this.adapters.logger?.info(
          DomainEventType.CalibrationReferenceCompleted,
          null,
          {
            run_id: runId,
            item_id: sourceItem.id,
            reference_vendor: options.reference.provider,
            duration_ms: Date.now() - referenceStartedAt,
          } satisfies ICalibrationReferenceCompletedPayload,
          runId,
        );
        items.push({
          id: sourceItem.id,
          targetScore: target.score,
          referenceScore: reference.score,
          targetLabel: deriveCalibrationLabel(target.score, options.rubric.label_threshold),
          referenceLabel: deriveCalibrationLabel(reference.score, options.rubric.label_threshold),
        });
      }

      const pairs = alignCalibrationPairs(
        items.map((item) => ({ id: item.id, score: item.targetScore })),
        items.map((item) => ({ id: item.id, score: item.referenceScore })),
      );

      const result: ICalibrationRunResult = {
        runId,
        generatedAt: this.adapters.clock.now().toISOString(),
        targetProvenance: options.target,
        referenceProvenance: options.reference,
        items,
        metrics: {
          exact: computeExactAgreement(pairs, options.rubric.label_threshold),
          kappa: computeCohenKappa(pairs, options.rubric.label_threshold),
          alpha: computeIntervalAlpha(pairs),
        },
        sampleCount: items.length,
        excludedCount: selection.excluded.length,
        realExecutionMarker: true,
      };

      operation = "store";
      await this.adapters.store.write(result);

      await this.adapters.logger?.info(
        DomainEventType.CalibrationScored,
        null,
        {
          run_id: runId,
          sample_count: result.sampleCount,
          excluded_count: result.excludedCount,
          metric_outcome: {
            exact: result.metrics.exact.value,
            kappa: result.metrics.kappa.value,
            alpha: result.metrics.alpha.value,
          },
          duration_ms: Date.now() - startedAt,
        } satisfies ICalibrationScoredPayload,
        runId,
      );

      return result;
    } catch (error) {
      await this.adapters.logger?.error(
        DomainEventType.CalibrationFailed,
        null,
        {
          run_id: runId,
          operation,
          error_code: classifyCalibrationErrorCode(error as Error),
          duration_ms: Date.now() - startedAt,
        } satisfies ICalibrationFailedPayload,
        runId,
      );
      throw error;
    }
  }
}

// Real (production) adapters

/** Scores via the real target judge, rejecting SKIPPED/ERROR/missing-score/mock results
 *  and a local-provider substitution — using the actual resolved provider/model captured
 *  from callLlmEndpoint, never the (env-echoed, unverified) legacy `judge` provenance field. */
export class LocalCalibrationJudgeAdapter implements ICalibrationJudgeAdapter {
  constructor(private readonly workspaceRoot: string) {}

  async score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult> {
    let captured: ICalibrationCaptureMetadata | undefined;
    const result = await evaluateLlmJudgeCriterion({
      workspaceRoot: this.workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: item.id,
        kind: CriterionKind.LLM_JUDGE,
        preset: rubric.preset,
        score_threshold: rubric.label_threshold,
        rubric: item.snapshot.request_context,
      },
      executionResult: {
        stepId: item.id,
        stepType: ScenarioStepType.SHELL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: 0,
        stdout: item.snapshot.artifact,
        stderr: "",
        combinedOutput: item.snapshot.artifact,
      },
      env: { EXA_EVAL_LLM_MOCK: "false", EXA_LLM_PROVIDER: target.provider, EXA_LLM_MODEL: target.model },
      calibrationCapture: (metadata) => {
        captured = metadata;
      },
    });

    if (result.status === CriterionStatus.SKIPPED) {
      throw new CalibrationRunnerError(`judge SKIPPED for "${item.id}": ${result.message}`);
    }
    if (result.status === CriterionStatus.ERROR) {
      throw new CalibrationRunnerError(`judge ERROR for "${item.id}": ${result.message}`);
    }
    if (result.score === undefined) {
      throw new CalibrationRunnerError(`judge produced no score for "${item.id}"`);
    }
    if (!captured) {
      throw new CalibrationRunnerError(`judge produced no capture metadata for "${item.id}" (mock result?)`);
    }
    if (captured.provider !== target.provider) {
      throw new CalibrationRunnerError(
        `judge provider substituted for "${item.id}": requested "${target.provider}", resolved "${captured.provider}"`,
      );
    }
    return { score: result.score, provider: captured.provider, model: captured.model };
  }
}

/** Scores via calibration_reference.ts's live cross-provider evaluator. */
export class LocalCalibrationReferenceAdapter implements ICalibrationReferenceAdapter {
  async score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult> {
    const result = await evaluateReference({
      requestContext: item.snapshot.request_context,
      artifact: item.snapshot.artifact,
      preset: rubric.preset,
      labelThreshold: rubric.label_threshold,
      referenceProvider: target.provider,
      referenceModel: target.model,
    });
    return { score: result.score, provider: result.provider, model: result.model };
  }
}

export class RealCalibrationSourceReaderAdapter implements ICalibrationSourceReaderAdapter {
  async read(options: IReadCalibrationSourcesOptions): Promise<ICalibrationSourceSelection> {
    return await readCalibrationSources(options);
  }
}

/** Writes the run result as JSON to `<directory>/<runId>.json`. */
export class FileCalibrationStoreAdapter implements ICalibrationStoreAdapter {
  constructor(private readonly directory: string) {}

  async write(result: ICalibrationRunResult): Promise<string> {
    await Deno.mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, `${result.runId}.json`);
    await Deno.writeTextFile(path, `${JSON.stringify(result, null, 2)}\n`);
    return path;
  }
}

export class SystemCalibrationClock implements ICalibrationClock {
  now(): Date {
    return new Date();
  }
}
