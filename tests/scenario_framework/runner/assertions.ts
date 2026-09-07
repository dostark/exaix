// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkAssertions
 * @path tests/scenario_framework/runner/assertions.ts
 * @description Implements Step 5 criterion evaluation primitives and
 * per-step failure classification for input validation, command execution, and
 * output validation.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/evidence_collector.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/tests/unit/assertions_evidence_test.ts]
 */

import { dirname, globToRegExp, isAbsolute, relative, resolve } from "@std/path";
import { levenshteinDistance } from "@std/text";
import { parse as parseYaml } from "@std/yaml";
import {
  CriterionKind,
  CriterionPhase,
  CriterionStatus,
  type ICriterion,
  type ICriterionResult,
  type IScenarioStep,
  ScenarioStepType,
} from "../schema/step_schema.ts";
import type { JSONValue, Opt, Reason } from "@exaix/core/types";
import type { IScenarioStepExecutionResult } from "./step_executor.ts";
import { resolveExecutionBase } from "./step_executor.ts";
import { gitServiceFor } from "./git_helpers.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import {
  buildEvaluationPrompt,
  calculateWeightedScore,
  CriterionResultSchema as JudgeResponseSchema,
  type EvaluationCriterion,
  type EvaluationResult,
  EvaluationResultSchema,
  resolveCriterionPreset,
} from "@exaix/core/evaluation";
import { type Config, DEFAULT_MODEL_PRESETS } from "@exaix/schemas";
import type { IModelIntent, IResolvedModel } from "@exaix/schemas";
import { getCriterionResultJsonSchema, getEvaluationResultJsonSchema } from "@exaix/schemas/evaluation_json_schema.ts";
import type { ICostTracker } from "@exaix/core/types";
import { ProviderFactory, ProviderRegistry } from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";
import { captureCalibrationEvidence } from "./calibration_sources.ts";
import { CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR } from "./capture_calibration_evidence_flag.ts";
import { ProviderType } from "@exaix/core";
import { DEFAULT_CLI_DELEGATE_TIMEOUT_MS } from "@exaix/ai-clidelegate";
import { ModelResolver } from "../../../packages/ai/src/model_resolver.ts";
import { DefaultRoutingStrategy } from "../../../packages/ai/src/routing/default_routing_strategy.ts";
import type { IProviderHealthChecker } from "../../../packages/ai/src/provider_selector.ts";
import type { ModelSize } from "../../../packages/schemas/src/model_intent.ts";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

/** The actual resolved provider/model and full generation result for one `callLlmEndpoint`
 *  call — distinct from its string-only return so an observer sees what was really used. */
export interface ILlmEndpointResolvedMetadata {
  provider: string;
  model: string;
  result: IGenerateResult;
}

/** Judge-calibration snapshot inputs: the target judge's raw evaluation materials,
 *  never its score/verdict — the reference evaluator must stay blind to it. */
export interface ICalibrationCaptureMetadata {
  requestContext: string;
  artifact: string;
  rubricMethodology: string;
  provider: string;
  model: string;
  promptUsed: string;
  rawResponse: string;
}

export interface IEvaluateCriterionOptions {
  workspaceRoot: string;
  /** The step's resolved working directory — file criteria resolve against it when set. */
  executionBase?: string;
  phase: CriterionPhase;
  criterion: ICriterion;
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  exactlExecutable?: string;
  /** Outcomes of steps that already ran this scenario (a judge's test_run_source). */
  stepOutcomes?: IScenarioStepOutcome[];
  /** Fires after a real (non-mock) llm-judge call resolves, before scoring. Absent by
   *  default — ordinary history/scoring behavior is unaffected either way. */
  calibrationCapture?: Opt<(metadata: ICalibrationCaptureMetadata) => void | Promise<void>, Reason.OptionalDependency>;
}

export interface IEvaluateStepOutcomeOptions {
  workspaceRoot: string;
  step: IScenarioStep;
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  verbose?: boolean;
  exactlExecutable?: string;
  /** Epoch-ms floor for artefacts this scenario may claim — see IExecuteScenarioStepOptions. */
  artifactBaselineMs?: number;
  /** Outcomes of steps that already ran this scenario (a judge's test_run_source). */
  stepOutcomes?: IScenarioStepOutcome[];
}

export interface IScenarioStepOutcome {
  stepId: string;
  status: CriterionStatus;
  failureStage: CriterionPhase | StepFailureStage.EXECUTION | null;
  criterionResults: ICriterionResult[];
  executionResult?: IScenarioStepExecutionResult;
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const JSON_PATH_ROOT = "$";

interface IJournalEvent {
  event_type?: string;
  action_type?: string;
  [key: string]: any;
}

/** A parsed journal-event payload: an open key→value map (the payload shape is event-specific). */
interface IJournalPayloadFields {
  [key: string]: JSONValue;
}

export enum StepFailureStage {
  INPUT = "input",
  EXECUTION = "execution",
  OUTPUT = "output",
}

type IFileExistsCriterion = Extract<ICriterion, { kind: CriterionKind.FILE_EXISTS }>;
type IFileFoundCriterion = Extract<ICriterion, { kind: CriterionKind.FILE_FOUND }>;
type IFileNotExistsCriterion = Extract<ICriterion, { kind: CriterionKind.FILE_NOT_EXISTS }>;
type ITextContainsCriterion = Extract<ICriterion, { kind: CriterionKind.TEXT_CONTAINS }>;
type IJsonPathExistsCriterion = Extract<ICriterion, { kind: CriterionKind.JSON_PATH_EXISTS }>;
type IJsonPathEqualsCriterion = Extract<ICriterion, { kind: CriterionKind.JSON_PATH_EQUALS }>;
type IJsonPathEqualsAnyCriterion = Extract<ICriterion, { kind: CriterionKind.JSON_PATH_EQUALS_ANY }>;
type IJsonQueryCriterion = Extract<ICriterion, { kind: CriterionKind.JSON_QUERY }>;
type IDirExistsCriterion = Extract<ICriterion, { kind: CriterionKind.DIR_EXISTS }>;
type IFrontmatterFieldExistsCriterion = Extract<ICriterion, { kind: CriterionKind.FRONTMATTER_FIELD_EXISTS }>;
type IFrontmatterFieldEqualsCriterion = Extract<ICriterion, { kind: CriterionKind.FRONTMATTER_FIELD_EQUALS }>;
type IJournalEventExistsCriterion = Extract<ICriterion, { kind: CriterionKind.JOURNAL_EVENT_EXISTS }>;
type ICommandExitCodeCriterion = Extract<ICriterion, { kind: CriterionKind.COMMAND_EXIT_CODE }>;
type IStatusEqualsCriterion = Extract<ICriterion, { kind: CriterionKind.STATUS_EQUALS }>;
type IPortalMountedCriterion = Extract<ICriterion, { kind: CriterionKind.PORTAL_MOUNTED }>;
type IEnvVarPresentCriterion = Extract<ICriterion, { kind: CriterionKind.ENV_VAR_PRESENT }>;
type ITextMatchesCriterion = Extract<ICriterion, { kind: CriterionKind.TEXT_MATCHES }>;
type IVersionEqualsCriterion = Extract<ICriterion, { kind: CriterionKind.VERSION_EQUALS }>;
type IVersionGteCriterion = Extract<ICriterion, { kind: CriterionKind.VERSION_GTE }>;
type IVersionLteCriterion = Extract<ICriterion, { kind: CriterionKind.VERSION_LTE }>;
type ICommandOutputContainsCriterion = Extract<ICriterion, { kind: CriterionKind.COMMAND_OUTPUT_CONTAINS }>;
type ICommandOutputNotContainsCriterion = Extract<ICriterion, { kind: CriterionKind.COMMAND_OUTPUT_NOT_CONTAINS }>;

interface IKeyValueDocument {
  [key: string]: any;
}

export async function evaluateCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  switch (options.criterion.kind) {
    case CriterionKind.FILE_EXISTS:
      return await evaluateFileExistsCriterion(options);
    case CriterionKind.FILE_FOUND:
      return await evaluateFileFoundCriterion(options);
    case CriterionKind.FILE_NOT_EXISTS:
      return await evaluateFileNotExistsCriterion(options);
    case CriterionKind.TEXT_CONTAINS:
      return await evaluateTextContainsCriterion(options);
    case CriterionKind.JSON_PATH_EXISTS:
      return await evaluateJsonPathExistsCriterion(options);
    case CriterionKind.JSON_PATH_EQUALS:
      return await evaluateJsonPathEqualsCriterion(options);
    case CriterionKind.JSON_PATH_EQUALS_ANY:
      return await evaluateJsonPathEqualsAnyCriterion(options);
    case CriterionKind.JSON_QUERY:
      return await evaluateJsonQueryCriterion(options);
    case CriterionKind.DIR_EXISTS:
      return await evaluateDirExistsCriterion(options);
    case CriterionKind.FRONTMATTER_FIELD_EXISTS:
      return await evaluateFrontmatterFieldExistsCriterion(options);
    case CriterionKind.FRONTMATTER_FIELD_EQUALS:
      return await evaluateFrontmatterFieldEqualsCriterion(options);
    case CriterionKind.JOURNAL_EVENT_EXISTS:
      return await evaluateJournalEventExistsCriterion(options);
    case CriterionKind.COMMAND_EXIT_CODE:
      return evaluateCommandExitCodeCriterion(options);
    case CriterionKind.STATUS_EQUALS:
      return evaluateStatusEqualsCriterion(options);
    case CriterionKind.PORTAL_MOUNTED:
      return evaluatePortalMountedCriterion(options);
    case CriterionKind.ENV_VAR_PRESENT:
      return evaluateEnvVarPresentCriterion(options);
    case CriterionKind.TEXT_MATCHES:
      return await evaluateTextMatchesCriterion(options);
    case CriterionKind.VERSION_EQUALS:
      return await evaluateVersionEqualsCriterion(options);
    case CriterionKind.VERSION_GTE:
      return await evaluateVersionGteCriterion(options);
    case CriterionKind.VERSION_LTE:
      return await evaluateVersionLteCriterion(options);
    case CriterionKind.COMMAND_OUTPUT_CONTAINS:
      return evaluateCommandOutputContainsCriterion(options);
    case CriterionKind.COMMAND_OUTPUT_NOT_CONTAINS:
      return evaluateCommandOutputNotContainsCriterion(options);
    case CriterionKind.LLM_JUDGE:
      return await evaluateLlmJudgeCriterion(options);
  }
}

export async function evaluateStepOutcome(
  options: IEvaluateStepOutcomeOptions,
): Promise<IScenarioStepOutcome> {
  // Trajectory-assert steps use criterion results populated by the step executor
  if (options.step.type === ScenarioStepType.TRAJECTORY_ASSERT) {
    const criterionResults = options.executionResult?.criterionResults ?? [];
    const allPassed = criterionResults.every((r) => r.status === "passed");
    return {
      stepId: options.step.id,
      status: allPassed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      failureStage: allPassed ? null : StepFailureStage.EXECUTION,
      criterionResults,
      executionResult: options.executionResult,
    };
  }
  // Resolve file_pattern if provided by the step
  let stepTargetFile: string | undefined = undefined;
  if (options.step.file_pattern) {
    const executionBase = await resolveExecutionBase(options.step, options.workspaceRoot, options.artifactBaselineMs);
    stepTargetFile = await resolveStepFilePattern(
      executionBase,
      options.step.file_pattern,
      options.artifactBaselineMs,
    );
  }

  // Rewrite criteria if step-level target file is resolved
  const inputCriteria = stepTargetFile
    ? rewriteCriteriaWithTarget(options.step.input_criteria, stepTargetFile)
    : options.step.input_criteria;

  const outputCriteria = stepTargetFile
    ? rewriteCriteriaWithTarget(options.step.output_criteria, stepTargetFile)
    : options.step.output_criteria;

  // The step's resolved working directory — file criteria (file-found, text-contains, ...) and
  // the file_pattern glob resolve against it, so scenarios declare short relative paths.
  const executionBase = await resolveExecutionBase(options.step, options.workspaceRoot, options.artifactBaselineMs);

  const inputResults = await evaluateCriteriaBatch({
    workspaceRoot: options.workspaceRoot,
    executionBase,
    phase: CriterionPhase.INPUT,
    criteria: inputCriteria,
    executionResult: options.executionResult,
    env: options.env,
    portalAliases: options.portalAliases,
    exactlExecutable: options.exactlExecutable,
    stepOutcomes: options.stepOutcomes,
  });

  if (hasFailedCriterion(inputResults)) {
    return {
      stepId: options.step.id,
      status: CriterionStatus.FAILED,
      failureStage: CriterionPhase.INPUT,
      criterionResults: inputResults,
      executionResult: options.executionResult,
    };
  }

  // For an expect_failure step, a non-zero exit is the expected outcome; without inverting this,
  // the short-circuit below skipped output criteria and refusal scenarios passed unevaluated.
  const expectFailure = options.step.expect_failure ?? false;
  const exitCode = options.executionResult?.exitCode ?? 0;
  const executionFailed = expectFailure ? exitCode === 0 : exitCode !== 0;

  if (executionFailed) {
    return {
      stepId: options.step.id,
      status: CriterionStatus.FAILED,
      failureStage: StepFailureStage.EXECUTION,
      criterionResults: inputResults,
      executionResult: options.executionResult,
    };
  }

  const outputResults = await evaluateCriteriaBatch({
    workspaceRoot: options.workspaceRoot,
    executionBase,
    phase: CriterionPhase.OUTPUT,
    criteria: outputCriteria,
    executionResult: options.executionResult,
    env: options.env,
    portalAliases: options.portalAliases,
    exactlExecutable: options.exactlExecutable,
    stepOutcomes: options.stepOutcomes,
  });
  const criterionResults = [...inputResults, ...outputResults];

  return {
    stepId: options.step.id,
    status: hasFailedCriterion(outputResults) ? CriterionStatus.FAILED : CriterionStatus.PASSED,
    failureStage: hasFailedCriterion(outputResults) ? CriterionPhase.OUTPUT : null,
    criterionResults,
    executionResult: options.executionResult,
  };
}

interface IEvaluateCriteriaBatchOptions {
  workspaceRoot: string;
  executionBase?: string;
  phase: CriterionPhase;
  criteria: ICriterion[];
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  exactlExecutable?: string;
  /** Outcomes of steps that already ran this scenario (a judge's test_run_source). */
  stepOutcomes?: IScenarioStepOutcome[];
}

async function evaluateCriteriaBatch(
  options: IEvaluateCriteriaBatchOptions,
): Promise<ICriterionResult[]> {
  const results: ICriterionResult[] = [];

  for (const criterion of options.criteria) {
    results.push(
      await evaluateCriterion({
        workspaceRoot: options.workspaceRoot,
        executionBase: options.executionBase,
        phase: options.phase,
        criterion,
        executionResult: options.executionResult,
        env: options.env,
        portalAliases: options.portalAliases,
        exactlExecutable: options.exactlExecutable,
        stepOutcomes: options.stepOutcomes,
      }),
    );
  }

  return results;
}

function hasFailedCriterion(results: ICriterionResult[]): boolean {
  return results.some((result) => result.status !== CriterionStatus.PASSED);
}

async function evaluateFileExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IFileExistsCriterion;
  const evidenceRefs = buildEvidenceRefs(options.workspaceRoot, criterion.path ?? "");
  if (!criterion.path) {
    return buildFailedResult(options, { message: "file-exists criterion has no path (no file_pattern to resolve it)" });
  }

  try {
    await Deno.stat(resolveCriterionPath(criterionBase(options), criterion.path));
    return buildPassedResult(options, evidenceRefs);
  } catch {
    return buildFailedResult(options, {
      message: `expected file to exist: ${criterion.path}`,
      evidenceRefs,
    });
  }
}

async function evaluateFileFoundCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IFileFoundCriterion;
  const matcher = globToRegExp(criterion.path_pattern);
  for await (const filePath of walkWorkspaceFiles(criterionBase(options))) {
    const relativePath = relative(options.workspaceRoot, filePath);
    if (matcher.test(relativePath)) {
      return buildPassedResult(options, [relativePath]);
    }
  }

  return buildFailedResult(options, {
    message: `expected file matching pattern: ${criterion.path_pattern}`,
    expectedValue: criterion.path_pattern,
  });
}

async function evaluateFileNotExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IFileNotExistsCriterion;
  if (!criterion.path) {
    return buildFailedResult(options, {
      message: "file-not-exists criterion has no path (no file_pattern to resolve it)",
    });
  }

  try {
    await Deno.stat(resolveCriterionPath(criterionBase(options), criterion.path));
    return buildFailedResult(options, {
      message: `expected file to be absent: ${criterion.path}`,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
    });
  } catch {
    return buildPassedResult(options, []);
  }
}

async function evaluateTextContainsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as ITextContainsCriterion;
  if (!criterion.path) {
    return buildFailedResult(options, {
      message: "text-contains criterion has no path (no file_pattern to resolve it)",
    });
  }
  const content = await safeReadTextFile(criterionBase(options), criterion.path);

  if (content === null) {
    return buildFailedResult(options, {
      message: `text file not found: ${criterion.path}`,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
    });
  }

  if (content.includes(criterion.contains)) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.path));
  }

  if (criterion.similarity_threshold !== undefined) {
    const similarity = getSimilarityScore(content, criterion.contains);
    if (similarity >= criterion.similarity_threshold) {
      return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.path));
    }
    return buildFailedResult(options, {
      message: `text in ${criterion.path} not similar enough to: ${criterion.contains} (similarity: ${
        similarity.toFixed(2)
      }, threshold: ${criterion.similarity_threshold})`,
      expectedValue: criterion.contains,
      observedValue: content,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
    });
  }

  return buildFailedResult(options, {
    message: `expected text in ${criterion.path}: ${criterion.contains}`,
    expectedValue: criterion.contains,
    observedValue: content,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
  });
}

async function evaluateTextMatchesCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as ITextMatchesCriterion;
  if (!criterion.path) {
    return buildFailedResult(options, {
      message: "text-matches criterion has no path (no file_pattern to resolve it)",
    });
  }
  const content = await safeReadTextFile(criterionBase(options), criterion.path);

  if (content === null) {
    return buildFailedResult(options, {
      message: `text file not found: ${criterion.path}`,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
    });
  }

  const missingPatterns: string[] = [];
  const flags = criterion.flags || "s";
  for (const pattern of criterion.matches) {
    try {
      const regex = new RegExp(pattern, flags);
      if (!regex.test(content)) {
        missingPatterns.push(pattern);
      }
    } catch (e) {
      return buildFailedResult(options, {
        message: `invalid regex pattern: ${pattern} - ${(e as Error).message}`,
        expectedValue: pattern,
      });
    }
  }

  if (missingPatterns.length === 0) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.path));
  }

  return buildFailedResult(options, {
    message: `text in ${criterion.path} did not match all required patterns. Missing: ${missingPatterns.join(", ")}`,
    expectedValue: criterion.matches,
    observedValue: content,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.path),
  });
}

async function evaluateJsonPathExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJsonPathExistsCriterion;
  const jsonDocument = await loadJsonCriterionDocument(options.workspaceRoot, criterion.target_file);
  if (jsonDocument === null) {
    return buildFailedResult(options, {
      message: `JSON target file not found: ${criterion.target_file ?? "<missing target_file>"}`,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
    });
  }

  const selection = readJsonPath(jsonDocument, criterion.path);
  if (selection.exists) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.target_file));
  }

  return buildFailedResult(options, {
    message: `expected JSON path to exist: ${criterion.path}`,
    expectedValue: criterion.path,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
  });
}

async function evaluateJsonPathEqualsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJsonPathEqualsCriterion;
  const jsonDocument = await loadJsonCriterionDocument(options.workspaceRoot, criterion.target_file);
  if (jsonDocument === null) {
    return buildFailedResult(options, {
      message: `JSON target file not found: ${criterion.target_file ?? "<missing target_file>"}`,
      expectedValue: criterion.equals,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
    });
  }

  const selection = readJsonPath(jsonDocument, criterion.path);
  if (selection.exists && valuesMatch(selection.value, criterion.equals, criterion.similarity_threshold)) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.target_file));
  }

  const failureMessage = criterion.similarity_threshold !== undefined && typeof selection.value === "string" &&
      typeof criterion.equals === "string"
    ? `expected JSON path ${criterion.path} to be similar to ${
      JSON.stringify(criterion.equals)
    } (threshold: ${criterion.similarity_threshold})`
    : `expected JSON path ${criterion.path} to equal ${JSON.stringify(criterion.equals)}`;

  return buildFailedResult(options, {
    message: failureMessage,
    expectedValue: criterion.equals,
    observedValue: selection.value,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
  });
}

async function evaluateJsonPathEqualsAnyCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJsonPathEqualsAnyCriterion;
  const jsonDocument = await loadJsonCriterionDocument(options.workspaceRoot, criterion.target_file);
  if (jsonDocument === null) {
    return buildFailedResult(options, {
      message: `JSON target file not found: ${criterion.target_file ?? "<missing target_file>"}`,
      expectedValue: criterion.values,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
    });
  }

  const selection = readJsonPath(jsonDocument, criterion.path);
  if (selection.exists && criterion.values.some((value) => valuesMatch(selection.value, value))) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.target_file));
  }

  return buildFailedResult(options, {
    message: `expected JSON path ${criterion.path} to equal one of ${JSON.stringify(criterion.values)}`,
    expectedValue: criterion.values,
    observedValue: selection.value,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
  });
}

async function evaluateFrontmatterFieldExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IFrontmatterFieldExistsCriterion;
  const frontmatter = await loadFrontmatterDocument(options.workspaceRoot, criterion.target_file);
  if (frontmatter === null) {
    return buildFailedResult(options, {
      message: `frontmatter target file not found: ${criterion.target_file ?? "<missing target_file>"}`,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
    });
  }

  if (Object.hasOwn(frontmatter, criterion.field)) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.target_file));
  }

  return buildFailedResult(options, {
    message: `expected frontmatter field to exist: ${criterion.field}`,
    expectedValue: criterion.field,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
  });
}

async function evaluateFrontmatterFieldEqualsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IFrontmatterFieldEqualsCriterion;
  const frontmatter = await loadFrontmatterDocument(options.workspaceRoot, criterion.target_file);
  if (frontmatter === null) {
    return buildFailedResult(options, {
      message: `frontmatter target file not found: ${criterion.target_file ?? "<missing target_file>"}`,
      expectedValue: criterion.equals,
      evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
    });
  }

  const observedValue = frontmatter[criterion.field];
  if (valuesMatch(observedValue, criterion.equals, criterion.similarity_threshold)) {
    return buildPassedResult(options, buildEvidenceRefs(options.workspaceRoot, criterion.target_file));
  }

  return buildFailedResult(options, {
    message: `expected frontmatter field ${criterion.field} to equal ${JSON.stringify(criterion.equals)}`,
    expectedValue: criterion.equals,
    observedValue,
    evidenceRefs: buildEvidenceRefs(options.workspaceRoot, criterion.target_file),
  });
}

async function evaluateJournalEventExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJournalEventExistsCriterion;
  let events: IJournalEvent[] | null = null;

  if (criterion.journal_file) {
    const content = await safeReadTextFile(options.workspaceRoot, criterion.journal_file);
    if (content !== null) {
      try {
        events = content.split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as IJournalEvent);
      } catch {
        // Fallback or error
      }
    }
  }

  if (events === null) {
    events = await loadJournalFromCli(options);
  }

  if (events === null) {
    return buildFailedResult(options, {
      message:
        `Failed to query journal via CLI (exactl not found or errored). ensure Exaix daemon is accessible and exactl is in PATH.`,
    });
  }

  // Modern Exaix uses 'action_type' for event identification in the SQLite journal.
  const typeMatches = events.filter((e) =>
    e.action_type === criterion.event_type || e.event_type === criterion.event_type
  );

  // Requires a matching event whose payload carries, under each named key, an array containing
  // every listed string — proving e.g. that ids pinned in request frontmatter actually reached
  // `skills.resolved`, which a bare event-type match can't distinguish from a different resolve.
  if (criterion.payload_includes) {
    const includes = criterion.payload_includes;
    if (typeMatches.some((e) => payloadIncludesAll(e, includes))) return buildPassedResult(options, []);
    const summary = JSON.stringify(includes);
    return buildFailedResult(options, {
      message: typeMatches.length === 0
        ? `expected journal event type: ${criterion.event_type}`
        : `expected a '${criterion.event_type}' event whose payload includes ${summary}, but no matching event did`,
      expectedValue: `${criterion.event_type} with payload including ${summary}`,
      observedValue: typeMatches.length === 0
        ? `Latest 50 events: ${events.slice(0, 50).map((e) => e.action_type || e.event_type).join(", ")}`
        : `${typeMatches.length} matching event(s), payloads: ${
          typeMatches.slice(0, 5).map((e) => String(e.payload)).join(" | ")
        }`,
    });
  }

  // Without a payload_absent predicate, a bare event-type match passes (backward-compatible).
  if (!criterion.payload_absent) {
    if (typeMatches.length > 0) return buildPassedResult(options, []);
    return buildFailedResult(options, {
      message: `expected journal event type: ${criterion.event_type}`,
      expectedValue: criterion.event_type,
      observedValue: `Latest 50 events: ${events.slice(0, 50).map((e) => e.action_type || e.event_type).join(", ")}`,
    });
  }

  // Requires a matching event whose payload omits every given key/value pair — proving e.g. an
  // ACCEPTED reconcile (no `rejected: true`) rather than a rejected one with the same event type.
  const accepted = typeMatches.some((e) => !payloadContainsAll(e, criterion.payload_absent!));
  if (accepted) return buildPassedResult(options, []);

  const absentSummary = JSON.stringify(criterion.payload_absent);
  return buildFailedResult(options, {
    message: typeMatches.length === 0
      ? `expected journal event type: ${criterion.event_type}`
      : `expected a '${criterion.event_type}' event whose payload omits ${absentSummary}, but every matching event carried it`,
    expectedValue: `${criterion.event_type} without payload ${absentSummary}`,
    observedValue: typeMatches.length === 0
      ? `Latest 50 events: ${events.slice(0, 50).map((e) => e.action_type || e.event_type).join(", ")}`
      : `${typeMatches.length} matching event(s), all carrying ${absentSummary}`,
  });
}

/** True when the event's payload (parsed from its serialized JSON string) contains EVERY key/value pair in `expected`. */
function payloadContainsAll(event: IJournalEvent, expected: IJournalPayloadFields): boolean {
  const payload = parseEventPayload(event);
  if (!payload) return false;
  return Object.entries(expected).every(([key, value]) =>
    key in payload && JSON.stringify(payload[key]) === JSON.stringify(value)
  );
}

/** True when, for every entry in `expected`, the event's payload holds an ARRAY under that key containing each listed string (membership, not equality). */
function payloadIncludesAll(event: IJournalEvent, expected: Record<string, string[]>): boolean {
  const payload = parseEventPayload(event);
  if (!payload) return false;
  return Object.entries(expected).every(([key, values]) => {
    const actual = payload[key];
    if (!Array.isArray(actual)) return false;
    return values.every((value) => actual.includes(value));
  });
}

/** The CLI journal serializes payload as a JSON string, but the NDJSON path may already hold an object. */
function parseEventPayload(event: IJournalEvent): IJournalPayloadFields | null {
  const raw = event.payload;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as IJournalPayloadFields;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw as IJournalPayloadFields;
  return null;
}

async function loadJournalFromCli(options: IEvaluateCriterionOptions): Promise<IJournalEvent[] | null> {
  const exactl = options.exactlExecutable || "exactl";
  try {
    const command = new Deno.Command(exactl, {
      args: ["journal", "--format", "json", "-n", "200"],
      stdout: "piped",
      stderr: "piped",
      env: options.env,
      cwd: options.workspaceRoot,
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;

    const text = new TextDecoder().decode(stdout);
    return JSON.parse(text) as IJournalEvent[];
  } catch {
    return null;
  }
}

function evaluateCommandExitCodeCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as ICommandExitCodeCriterion;
  const observedValue = options.executionResult?.exitCode;
  if (observedValue === criterion.equals) {
    return buildPassedResult(options, []);
  }

  return buildFailedResult(options, {
    message: `expected exit code ${criterion.equals} but received ${String(observedValue)}`,
    expectedValue: criterion.equals,
    observedValue,
  });
}

function evaluateStatusEqualsCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IStatusEqualsCriterion;
  const observedValue = options.executionResult?.stdout.trim() ?? "";
  if (observedValue === criterion.equals) {
    return buildPassedResult(options, []);
  }

  return buildFailedResult(options, {
    message: `expected status ${criterion.equals} but received ${observedValue}`,
    expectedValue: criterion.equals,
    observedValue,
  });
}

function evaluatePortalMountedCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IPortalMountedCriterion;
  const isMounted = options.portalAliases?.includes(criterion.alias) ?? false;
  if (isMounted) {
    return buildPassedResult(options, []);
  }

  return buildFailedResult(options, {
    message: `expected mounted portal alias: ${criterion.alias}`,
    expectedValue: criterion.alias,
  });
}

function evaluateEnvVarPresentCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IEnvVarPresentCriterion;
  const envValue = options.env?.[criterion.env_var] ?? Deno.env.get(criterion.env_var) ?? null;
  if (envValue !== null && envValue.length > 0) {
    return buildPassedResult(options, []);
  }

  return buildFailedResult(options, {
    message: `expected env var to be present: ${criterion.env_var}`,
    expectedValue: criterion.env_var,
  });
}

interface ICriterionResultBuildOptions {
  message: string;
  evidenceRefs?: string[];
  observedValue?: any;
  expectedValue?: any;
}

function buildPassedResult(
  options: IEvaluateCriterionOptions,
  evidenceRefs: string[],
): ICriterionResult {
  return {
    criterion_id: options.criterion.id,
    kind: options.criterion.kind,
    phase: options.phase,
    status: CriterionStatus.PASSED,
    message: options.criterion.message ?? `${options.criterion.id} passed`,
    evidence_refs: evidenceRefs,
    score_weight: options.criterion.score_weight,
    class: options.criterion.class,
  };
}

function buildFailedResult(
  options: IEvaluateCriterionOptions,
  failure: ICriterionResultBuildOptions,
): ICriterionResult {
  return {
    criterion_id: options.criterion.id,
    kind: options.criterion.kind,
    phase: options.phase,
    status: CriterionStatus.FAILED,
    message: failure.message,
    evidence_refs: failure.evidenceRefs ?? [],
    observed_value: failure.observedValue,
    expected_value: failure.expectedValue,
    score_weight: options.criterion.score_weight,
    class: options.criterion.class,
  };
}

/** The base directory file criteria resolve against: the step's resolved cwd, else the workspace. */
function criterionBase(options: IEvaluateCriterionOptions): string {
  return options.executionBase ?? options.workspaceRoot;
}

function resolveCriterionPath(workspaceRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    return relativePath;
  }
  const resolvedPath = resolve(workspaceRoot, relativePath);
  const workspacePrefix = `${resolve(workspaceRoot)}/`;
  if (resolvedPath !== resolve(workspaceRoot) && !resolvedPath.startsWith(workspacePrefix)) {
    throw new Error(`criterion path escapes workspace root: ${relativePath}`);
  }

  return resolvedPath;
}

function buildEvidenceRefs(
  workspaceRoot: string,
  relativePath?: Opt<string, Reason.OptionalInput>,
): string[] {
  if (!relativePath) {
    return [];
  }

  const resolvedPath = resolveCriterionPath(workspaceRoot, relativePath);
  try {
    Deno.statSync(resolvedPath);
    return [relativePath];
  } catch {
    return [];
  }
}

async function safeReadTextFile(workspaceRoot: string, relativePath: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(resolveCriterionPath(workspaceRoot, relativePath));
  } catch {
    return null;
  }
}

async function loadJsonCriterionDocument(
  workspaceRoot: string,
  targetFile?: Opt<string, Reason.OptionalInput>,
): Promise<unknown | null> {
  if (!targetFile) {
    return null;
  }

  const content = await safeReadTextFile(workspaceRoot, targetFile);
  return content === null ? null : JSON.parse(content);
}

async function loadFrontmatterDocument(
  workspaceRoot: string,
  targetFile?: Opt<string, Reason.OptionalInput>,
): Promise<IKeyValueDocument | null> {
  if (!targetFile) {
    return null;
  }

  const content = await safeReadTextFile(workspaceRoot, targetFile);
  if (content === null) {
    return null;
  }

  const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
  if (!frontmatterMatch) {
    return {};
  }

  const parsedFrontmatter = parseYaml(frontmatterMatch[1]);
  if (parsedFrontmatter === null || typeof parsedFrontmatter !== "object" || Array.isArray(parsedFrontmatter)) {
    return {};
  }

  return parsedFrontmatter as IKeyValueDocument;
}

interface IJsonPathSelection {
  exists: boolean;
  value?: any;
}

function readJsonPath(document: any, jsonPath: string): IJsonPathSelection {
  if (jsonPath === JSON_PATH_ROOT) {
    return {
      exists: true,
      value: document,
    };
  }

  if (!jsonPath.startsWith(`${JSON_PATH_ROOT}.`)) {
    return { exists: false };
  }

  const tokens = jsonPath
    .slice(2)
    .replaceAll("[", ".")
    .replaceAll("]", "")
    .split(".")
    .filter((token) => token.length > 0);

  let cursor: any = document;
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return { exists: false };
      }
      cursor = cursor[index];
      continue;
    }

    if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, token)) {
      return { exists: false };
    }

    cursor = (cursor as IKeyValueDocument)[token];
  }

  return {
    exists: true,
    value: cursor,
  };
}

function valuesMatch(
  left: any,
  right: any,
  similarityThreshold?: Opt<number, Reason.OptionalInput>,
): boolean {
  if (similarityThreshold !== undefined && typeof left === "string" && typeof right === "string") {
    return getSimilarityScore(left, right) >= similarityThreshold;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function getSimilarityScore(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - (distance / Math.max(a.length, b.length));
}

async function* walkWorkspaceFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory) {
      if (!entry.name.startsWith(".")) {
        yield* walkWorkspaceFiles(entryPath);
      }
      continue;
    }

    if (entry.isFile) {
      yield entryPath;
    }
  }
}

// Resolves a step's `file_pattern` to the MOST RECENTLY WRITTEN match: scenarios in a pack
// share one sandbox workspace, so picking the first directory-walk match could validate an
// arbitrary earlier scenario's artefact. Ties fall back to the lexically greatest path.
async function resolveStepFilePattern(
  workspaceRoot: string,
  pattern: string,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<string | undefined> {
  const matcher = globToRegExp(pattern);
  let best: { relativePath: string; modifiedMs: number } | undefined;

  for await (const filePath of walkWorkspaceFiles(workspaceRoot)) {
    const relativePath = relative(workspaceRoot, filePath);
    if (!matcher.test(relativePath)) continue;

    let modifiedMs = 0;
    try {
      modifiedMs = (await Deno.stat(filePath)).mtime?.getTime() ?? 0;
    } catch {
      continue; // vanished between walk and stat — ignore rather than fail resolution
    }
    // Reject artefacts written before this scenario began — they belong to an earlier
    // scenario sharing the sandbox workspace.
    if (baselineMs !== undefined && modifiedMs < baselineMs) continue;

    const isNewer = best === undefined ||
      modifiedMs > best.modifiedMs ||
      (modifiedMs === best.modifiedMs && relativePath > best.relativePath);
    if (isNewer) best = { relativePath, modifiedMs };
  }

  return best?.relativePath;
}

function rewriteCriteriaWithTarget(
  criteria: ICriterion[],
  targetFile: string,
): ICriterion[] {
  return criteria.map((original) => {
    const criterion = { ...original } as ICriterion & Record<string, string | number | boolean | null | undefined>;

    const kindsWithTargetFile = [
      CriterionKind.JSON_PATH_EXISTS,
      CriterionKind.JSON_PATH_EQUALS,
      CriterionKind.JSON_PATH_EQUALS_ANY,
      CriterionKind.FRONTMATTER_FIELD_EXISTS,
      CriterionKind.FRONTMATTER_FIELD_EQUALS,
    ];

    const kindsWithFilePath = [
      CriterionKind.TEXT_CONTAINS,
      CriterionKind.TEXT_MATCHES,
      CriterionKind.FILE_EXISTS,
      CriterionKind.FILE_NOT_EXISTS,
    ];

    if (kindsWithTargetFile.includes(criterion.kind) && !criterion.target_file) {
      criterion.target_file = targetFile;
    }

    if (kindsWithFilePath.includes(criterion.kind) && !criterion.path) {
      criterion.path = targetFile;
    }

    return criterion as ICriterion;
  });
}

// Version Assertion Criteria

function evaluateVersionEqualsCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IVersionEqualsCriterion;
  const observedVersion = criterion.source === "binary" ? BINARY_VERSION : WORKSPACE_SCHEMA_VERSION;
  const passed = observedVersion === criterion.version;

  return {
    criterion_id: criterion.id,
    kind: CriterionKind.VERSION_EQUALS,
    phase: options.phase,
    status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: passed
      ? `Version matches: ${observedVersion}`
      : `Expected version ${criterion.version}, got ${observedVersion}`,
    evidence_refs: [],
    observed_value: observedVersion,
    expected_value: criterion.version,
  };
}

function evaluateVersionGteCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IVersionGteCriterion;
  const observedVersion = criterion.source === "binary" ? BINARY_VERSION : WORKSPACE_SCHEMA_VERSION;
  const passed = compareVersions(observedVersion, criterion.version) >= 0;

  return {
    criterion_id: criterion.id,
    kind: CriterionKind.VERSION_GTE,
    phase: options.phase,
    status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: passed
      ? `Version ${observedVersion} >= ${criterion.version}`
      : `Version ${observedVersion} is less than required ${criterion.version}`,
    evidence_refs: [],
    observed_value: observedVersion,
    expected_value: `>= ${criterion.version}`,
  };
}

function evaluateVersionLteCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as IVersionLteCriterion;
  const observedVersion = criterion.source === "binary" ? BINARY_VERSION : WORKSPACE_SCHEMA_VERSION;
  const passed = compareVersions(observedVersion, criterion.version) <= 0;

  return {
    criterion_id: criterion.id,
    kind: CriterionKind.VERSION_LTE,
    phase: options.phase,
    status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: passed
      ? `Version ${observedVersion} <= ${criterion.version}`
      : `Version ${observedVersion} is greater than maximum ${criterion.version}`,
    evidence_refs: [],
    observed_value: observedVersion,
    expected_value: `<= ${criterion.version}`,
  };
}

/** The number `min`/`max` compare against: a query resolving to a number IS the quantity (not its length), unlike arrays/strings which count elements/characters. */
interface IComparableNumber {
  value: number;
  noun: string;
}

function isNonEmptyJsonQueryResult(result: Opt<JSONValue, Reason.OptionalInput>): boolean {
  if (Array.isArray(result)) {
    return result.length > 0 && result.every(isNonEmptyJsonQueryResult);
  }
  return result !== undefined && result !== null && result !== "";
}

function comparableNumber(result: JSONValue): IComparableNumber {
  if (typeof result === "number" && Number.isFinite(result)) return { value: result, noun: "" };
  if (Array.isArray(result)) return { value: result.length, noun: "items" };
  if (typeof result === "string") return { value: result.length, noun: "characters" };
  return { value: 0, noun: "items" };
}

function evaluateJsonQueryCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJsonQueryCriterion;
  // For JSON query, we evaluate against the stdout of the command (e.g., journal query output)
  const outputData = options.executionResult?.stdout || "{}";

  try {
    const data = JSON.parse(outputData);

    // A leading "." (as in ".[].field") produces an empty first segment, skipped rather than
    // indexed with key "". After a "[]"/"[*]" map segment, subsequent field lookups project
    // across each array element rather than onto the array itself.
    const queryParts = criterion.query.split(".").filter((part) => part.length > 0);
    let result: any = data;
    let mapped = false;

    for (const part of queryParts) {
      if (part === "[]" || part === "[*]") {
        result = Array.isArray(result) ? result : [result];
        mapped = true;
      } else if (part.startsWith("[") && part.endsWith("]")) {
        const index = parseInt(part.slice(1, -1), 10);
        result = Array.isArray(result) ? result[index] : undefined;
      } else if (mapped && Array.isArray(result)) {
        result = result.map((item) => (item as Record<string, JSONValue>)?.[part]);
      } else {
        result = (result as Record<string, JSONValue>)?.[part];
      }
    }

    let passed = true;
    let message = `JSON query "${criterion.query}" succeeded`;

    if (criterion.equals !== undefined) {
      passed = JSON.stringify(result) === JSON.stringify(criterion.equals);
      message = passed
        ? `JSON query "${criterion.query}" equals ${JSON.stringify(criterion.equals)}`
        : `JSON query "${criterion.query}" returned ${JSON.stringify(result)}, expected ${
          JSON.stringify(criterion.equals)
        }`;
    } else if (criterion.contains) {
      // JSON.stringify(undefined) returns the JS value undefined (not the string
      // "undefined"), which would throw on .includes() below — treat a missing result
      // as the empty string so `contains` cleanly fails instead of erroring.
      const resultStr = JSON.stringify(result) ?? "";
      passed = criterion.contains.every((v) => resultStr.includes(v));
      message = passed
        ? `JSON query "${criterion.query}" contains all specified values`
        : `JSON query "${criterion.query}" result does not contain all specified values`;
    } else if (criterion.not_empty) {
      passed = isNonEmptyJsonQueryResult(result);
      message = passed
        ? `JSON query "${criterion.query}" returned non-empty value`
        : `JSON query "${criterion.query}" returned empty value`;
    } else if (criterion.min !== undefined) {
      const { value, noun } = comparableNumber(result);
      passed = value >= criterion.min;
      message = passed
        ? `JSON query "${criterion.query}" returned ${value} ${noun} (>= ${criterion.min})`
        : `JSON query "${criterion.query}" returned ${value} ${noun}, expected >= ${criterion.min}`;
    } else if (criterion.max !== undefined) {
      const { value, noun } = comparableNumber(result);
      passed = value <= criterion.max;
      message = passed
        ? `JSON query "${criterion.query}" returned ${value} ${noun} (<= ${criterion.max})`
        : `JSON query "${criterion.query}" returned ${value} ${noun}, expected <= ${criterion.max}`;
    } else if (criterion.unique_count_min !== undefined) {
      if (!Array.isArray(result)) {
        passed = false;
        message = `JSON query "${criterion.query}" must return an array for unique_count_min check`;
      } else {
        const uniqueValues = new Set(result.map((v) => JSON.stringify(v)));
        passed = uniqueValues.size >= criterion.unique_count_min;
        message = passed
          ? `JSON query "${criterion.query}" returned ${uniqueValues.size} unique items (>= ${criterion.unique_count_min})`
          : `JSON query "${criterion.query}" returned ${uniqueValues.size} unique items, expected >= ${criterion.unique_count_min}`;
      }
    }

    return Promise.resolve({
      criterion_id: criterion.id,
      kind: CriterionKind.JSON_QUERY,
      phase: options.phase,
      status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      message,
      evidence_refs: [],
      observed_value: result,
      expected_value: criterion.equals ?? criterion.contains ?? criterion.not_empty ?? criterion.min ?? criterion.max ??
        criterion.unique_count_min,
    });
  } catch (_error) {
    return Promise.resolve({
      criterion_id: criterion.id,
      kind: CriterionKind.JSON_QUERY,
      phase: options.phase,
      status: CriterionStatus.ERROR,
      message: `Failed to evaluate JSON query`,
      evidence_refs: [],
    });
  }
}

async function evaluateDirExistsCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IDirExistsCriterion;

  try {
    const dirPath = resolve(options.workspaceRoot, criterion.path);
    const stat = await Deno.stat(dirPath);
    const passed = stat.isDirectory;

    return {
      criterion_id: criterion.id,
      kind: CriterionKind.DIR_EXISTS,
      phase: options.phase,
      status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      message: passed ? `Directory exists: ${criterion.path}` : `Path exists but is not a directory: ${criterion.path}`,
      evidence_refs: [criterion.path],
      observed_value: stat.isDirectory,
      expected_value: true,
    };
  } catch (_error) {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.DIR_EXISTS,
      phase: options.phase,
      status: CriterionStatus.FAILED,
      message: `Directory does not exist: ${criterion.path}`,
      evidence_refs: [],
      expected_value: true,
    };
  }
}

function evaluateCommandOutputContainsCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as ICommandOutputContainsCriterion;
  const stdout = options.executionResult?.stdout ?? "";
  const stderr = options.executionResult?.stderr ?? "";
  const combined = stdout + stderr;

  const missing = criterion.contains.filter((sub) => !combined.includes(sub));
  const passed = missing.length === 0;

  return {
    criterion_id: criterion.id,
    kind: CriterionKind.COMMAND_OUTPUT_CONTAINS,
    phase: options.phase,
    status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: passed
      ? `Command output contains all expected patterns`
      : `Command output missing patterns: ${missing.join(", ")}`,
    evidence_refs: [],
    observed_value: combined,
    expected_value: criterion.contains,
  };
}

/** Assert that none of the forbidden patterns appear in the combined stdout+stderr output. */
function evaluateCommandOutputNotContainsCriterion(
  options: IEvaluateCriterionOptions,
): ICriterionResult {
  const criterion = options.criterion as ICommandOutputNotContainsCriterion;
  const stdout = options.executionResult?.stdout ?? "";
  const stderr = options.executionResult?.stderr ?? "";
  const combined = stdout + stderr;

  const found = criterion.not_contains.filter((pattern) => combined.includes(pattern));
  const passed = found.length === 0;

  return {
    criterion_id: criterion.id,
    kind: CriterionKind.COMMAND_OUTPUT_NOT_CONTAINS,
    phase: options.phase,
    status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: passed
      ? `Command output contains none of the forbidden patterns`
      : `Command output contains forbidden patterns: ${found.join(", ")}`,
    evidence_refs: [],
    observed_value: combined,
    expected_value: criterion.not_contains,
  };
}

// Prefers dedicated `EXA_EVAL_LLM_PROVIDER`/`EXA_EVAL_LLM_MODEL` judge vars over the scenario's
// own `EXA_LLM_PROVIDER`/`EXA_LLM_MODEL`, so the judge model can differ from the execution model.
// A provider without a model falls back to `EXA_EVAL_MODEL_SIZE`, then the provider itself.
export function resolveEvalJudgeProvenance(
  env?: Opt<{ [key: string]: string }, Reason.OptionalInput>,
): { provider: string; model: string } | undefined {
  const provider = env?.EXA_EVAL_LLM_PROVIDER ?? env?.EXA_LLM_PROVIDER ?? Deno.env.get("EXA_LLM_PROVIDER");
  const model = env?.EXA_EVAL_LLM_MODEL ?? env?.EXA_LLM_MODEL ?? Deno.env.get("EXA_LLM_MODEL");
  if (provider && model) return { provider, model };
  if (provider) {
    const modelFromSize = env?.EXA_EVAL_MODEL_SIZE ?? Deno.env.get("EXA_EVAL_MODEL_SIZE");
    return { provider, model: modelFromSize ?? provider };
  }
  return undefined;
}

/** Builds a synthetic structured EvaluationResult for multi-criteria preset sets in mock mode, to exercise the weighted-score composition path. */
function buildMockMultiCriteriaResult(
  criteria: EvaluationCriterion[],
): EvaluationResult {
  const criteriaScores: Record<string, { score: number; reasoning: string; issues: string[]; passed: boolean }> = {};
  for (const c of criteria) {
    criteriaScores[c.name] = { score: 1.0, reasoning: "mock pass", issues: [], passed: true };
  }
  return {
    overallScore: 1.0,
    criteriaScores,
    pass: true,
    feedback: "Mock evaluation: all criteria pass",
    suggestions: [],
  };
}

/** The evidence references an llm-judge criterion claims, in precedence order: the whole-repo
 *  branch diff dir, a single-file diff, or a raw evidence file. Recorded in the criterion
 *  result so a run manifest shows WHAT the judge was asked to evaluate. */
function llmJudgeEvidenceRefs(
  criterion: ICriterion & { evidence_path?: string; evidence_diff_path?: string; evidence_diff_dir?: string },
): string[] {
  if (criterion.evidence_diff_dir) return [criterion.evidence_diff_dir];
  if (criterion.evidence_diff_path) return [criterion.evidence_diff_path];
  if (criterion.evidence_path) return [criterion.evidence_path];
  return [];
}

/** Format a declared test-run step's outcome (PASSED/FAILED + exit code + output) for the
 *  judge's context, so it grades the solution WITH the test signal, never without it. */
export function resolveTestRunStatus(
  testRunSource: Opt<string, Reason.OptionalInput> = undefined,
  stepOutcomes: Opt<IScenarioStepOutcome[], Reason.OptionalInput> = undefined,
): string | undefined {
  if (!testRunSource || !stepOutcomes) return undefined;
  const outcome = stepOutcomes.find((o) => o.stepId === testRunSource);
  if (!outcome) return undefined;
  const passed = outcome.status === CriterionStatus.PASSED;
  const exitCode = outcome.executionResult?.exitCode ?? 0;
  const output = (outcome.executionResult?.combinedOutput ?? "").slice(0, 2000);
  return `${passed ? "PASSED" : "FAILED"} (exit code ${exitCode})\n${output}`.trim();
}

/** Attach the judge's CAPTURED reasoning to the judge provenance so run artifacts prove the
 *  judge actually reasoned over the supplied evidence, rather than a bare provider/model tag. */
function judgeResult(
  provenance: Opt<{ provider: string; model: string }, Reason.OptionalInput> = undefined,
  reasoning: string,
): { provider: string; model: string; reasoning: string } | undefined {
  return provenance ? { ...provenance, reasoning } : undefined;
}

// Resolves the `context` buildEvaluationPrompt receives: `context_path`'s file content when set
// (lets the judge score "goal_alignment" against a real stated objective), else `rubric`. A
// missing/unreadable context_path degrades to the rubric fallback rather than failing the step.
export async function resolveEvalJudgeContext(
  options: { workspaceRoot: string; rubric?: string; contextPath?: string },
): Promise<string | undefined> {
  if (options.contextPath) {
    const resolvedPath = resolve(options.workspaceRoot, options.contextPath);
    try {
      return await Deno.readTextFile(resolvedPath);
    } catch {
      // fall through to rubric
    }
  }
  return options.rubric;
}

// Reads judge-methodology skill files directly from Memory/Skills/global/ rather than through
// SkillsService/AgentRunner, since that would need a DB and risks EXA_EVAL_SUPPRESS_SKILLS (set
// for the arm under test) leaking into the judge's own skill resolution in the same process.
export async function loadJudgeMethodologyInstructions(workspaceRoot: string): Promise<string> {
  const skillIds = ["verdict-rubric", "response-contract-judge"];
  const parts: string[] = [];
  for (const skillId of skillIds) {
    const path = resolve(workspaceRoot, "Memory", "Skills", "global", `${skillId}.json`);
    try {
      const raw = await Deno.readTextFile(path);
      const parsed = JSON.parse(raw) as { instructions?: string };
      if (parsed.instructions) parts.push(parsed.instructions);
    } catch {
      // Missing/unreadable/malformed — skip this skill's contribution, don't fail the judge.
    }
  }
  return parts.join("\n\n---\n\n");
}

/** Prepends methodology ahead of the evaluation request so the judge reads "how to judge" before "what to judge"; empty methodology returns the prompt unchanged. */
export function prependMethodologyInstructions(prompt: string, methodology: string): string {
  if (!methodology) return prompt;
  return `${methodology}\n\n---\n\n${prompt}`;
}

const GIT_DIFF_NO_CHANGES_MESSAGE = "(no changes — working tree matches the initial commit)";

/** A repo-scoped native git layer for evidence diffing — the Exaix GitService, never a raw git
 *  CLI spawn. Throws on failure, returns captured stdout. */
async function runGitCapture(cwd: string, args: string[]): Promise<string> {
  const result = await gitServiceFor(cwd).runGitCommand(args);
  return result.output;
}

// Diffs `trackedFilePath` between its repo's root commit and the WORKING TREE, not HEAD: a
// solved trial can leave its correct fix uncommitted, and a root..HEAD diff would then report
// "(no changes)" on code that was genuinely fixed. An empty diff is still reported explicitly.
export async function computeGitDiffEvidence(
  workspaceRoot: string,
  trackedFilePath: string,
  diffWholeBranch = false,
): Promise<string> {
  const absolutePath = resolve(workspaceRoot, trackedFilePath);
  const containingDir = diffWholeBranch ? absolutePath : dirname(absolutePath);

  const repoRoot = (await runGitCapture(containingDir, ["rev-parse", "--show-toplevel"])).trim();
  const rootCommit = (await runGitCapture(repoRoot, ["rev-list", "--max-parents=0", "HEAD"])).trim().split("\n")[0];

  const relativePath = relative(repoRoot, absolutePath);
  // Whole-branch mode diffs EVERY applied change vs the repo's root commit — the complete
  // worktree-branch delta a judge on a code-change task must see, not a single pre-picked file.
  const pathArgs = diffWholeBranch ? [] : ["--", relativePath];

  const diff = await runGitCapture(repoRoot, ["diff", rootCommit, ...pathArgs]);
  return diff.trim().length > 0 ? diff : GIT_DIFF_NO_CHANGES_MESSAGE;
}

async function resolveCalibrationSourceRevision(workspaceRoot: string): Promise<string> {
  try {
    return (await runGitCapture(workspaceRoot, ["rev-parse", "HEAD"])).trim();
  } catch {
    return "unversioned";
  }
}

// An explicit options.calibrationCapture always wins (test/CalibrationRunner injection); absent
// that, --capture-calibration-evidence's env var (capture_calibration_evidence_flag.ts) builds a
// default writer so an ordinary real scenario run can accumulate a calibration set unattended.
function resolveEffectiveCalibrationCapture(
  explicit: Opt<(metadata: ICalibrationCaptureMetadata) => void | Promise<void>, Reason.OptionalDependency>,
  criterionId: string,
  workspaceRoot: string,
): ((metadata: ICalibrationCaptureMetadata) => Promise<void>) | undefined {
  if (explicit) return async (metadata) => await explicit(metadata);

  const captureDirectory = Deno.env.get(CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR);
  if (!captureDirectory) return undefined;

  return async (metadata: ICalibrationCaptureMetadata) => {
    const sourceRevision = await resolveCalibrationSourceRevision(workspaceRoot);
    await captureCalibrationEvidence({
      captureDirectory,
      runId: crypto.randomUUID(),
      stepId: criterionId,
      requestContext: metadata.requestContext,
      artifact: metadata.artifact,
      rubricMethodology: metadata.rubricMethodology,
      executionStatus: "completed",
      sourceRevision,
    });
  };
}

export async function evaluateLlmJudgeCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as ICriterion & {
    evidence_path?: string;
    evidence_diff_path?: string;
    evidence_diff_dir?: string;
    preset?: string;
    rubric?: string;
    context_path?: string;
    test_run_source?: string;
    score_threshold?: number;
  };

  if (!criterion.preset && !criterion.rubric) {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.ERROR,
      message: "llm-judge requires either 'preset' or 'rubric'",
      evidence_refs: [],
      score_weight: options.criterion.score_weight,
    };
  }

  const effectiveCriteria = criterion.preset ? resolveCriterionPreset(criterion.preset) : [];
  const isMulti = effectiveCriteria.length > 1;

  // For a code-change task the evidence is the worktree branch diff; the prompt must EXPLICITLY
  // tell the judge what the content is and to compare it against the reference patch in the
  // context — otherwise a judge reading bare diff text can still guess without grounding.
  const GIT_DIFF_EVIDENCE_HEADER =
    "The content below is the git diff of the code changes applied in the worktree branch for " +
    "this task. Evaluate whether these applied changes comply with the task goal, and compare " +
    "them against the reference patch provided in the Context. Cite the actual changed lines " +
    "you considered in your reasoning.";
  let content = "";
  let isGitDiff = false;
  if (criterion.evidence_diff_dir) {
    content = await computeGitDiffEvidence(options.workspaceRoot, criterion.evidence_diff_dir, true);
    isGitDiff = true;
  } else if (criterion.evidence_diff_path) {
    content = await computeGitDiffEvidence(options.workspaceRoot, criterion.evidence_diff_path);
    isGitDiff = true;
  } else if (criterion.evidence_path) {
    const resolvedPath = resolve(options.workspaceRoot, criterion.evidence_path);
    try {
      content = await Deno.readTextFile(resolvedPath);
    } catch {
      content = options.executionResult?.stdout ?? "";
    }
  } else {
    content = options.executionResult?.stdout ?? "";
  }
  if (isGitDiff && content.trim().length > 0) {
    content = `${GIT_DIFF_EVIDENCE_HEADER}\n\n${content}`;
  }

  const evalContext = await resolveEvalJudgeContext({
    workspaceRoot: options.workspaceRoot,
    rubric: criterion.rubric,
    contextPath: criterion.context_path,
  });
  // Pass the declared test-run step's status to the judge as ADDITIONAL context. A judge must
  // run and grade even when the tests failed — the failure IS the signal being evaluated.
  const testStatus = resolveTestRunStatus(criterion.test_run_source, options.stepOutcomes);
  const contextWithTests = testStatus
    ? `${evalContext ?? ""}\n\n## Test Run Result (${criterion.test_run_source})\n${testStatus}`
    : evalContext;
  const basePrompt = buildEvaluationPrompt(content, effectiveCriteria, contextWithTests, isMulti);
  const methodology = await loadJudgeMethodologyInstructions(options.workspaceRoot);
  const promptUsed = prependMethodologyInstructions(basePrompt, methodology);
  const threshold = criterion.score_threshold ?? 0.7;
  const judgeProvenance = resolveEvalJudgeProvenance(options.env);

  const mockSetting = options.env?.EXA_EVAL_LLM_MOCK ?? Deno.env.get("EXA_EVAL_LLM_MOCK");

  // Unset → SKIPPED (no LLM configured)
  if (mockSetting === undefined || mockSetting === "") {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.SKIPPED,
      message: "LLM judge skipped: no LLM configured. " +
        "Set EXA_EVAL_LLM_MOCK=pass for auto-pass in self-tests, " +
        "or set EXA_LLM_PROVIDER for real evaluation.",
      evidence_refs: llmJudgeEvidenceRefs(criterion),
      score_weight: options.criterion.score_weight,
    };
  }

  // EXA_EVAL_LLM_MOCK=pass → auto-pass (with multi-criteria composition for preset sets)
  if (mockSetting === "pass") {
    if (isMulti) {
      const mockResult = buildMockMultiCriteriaResult(effectiveCriteria);
      const weightedScore = calculateWeightedScore(mockResult.criteriaScores, effectiveCriteria);
      const perCriterionSummary = effectiveCriteria.map((c) =>
        `${c.name}: ${mockResult.criteriaScores[c.name]?.score.toFixed(2) ?? "N/A"}`
      ).join("; ");
      return {
        criterion_id: criterion.id,
        kind: CriterionKind.LLM_JUDGE,
        phase: options.phase,
        status: weightedScore >= threshold ? CriterionStatus.PASSED : CriterionStatus.FAILED,
        message: `LLM judge preset "${criterion.preset}": mock weighted score ${
          weightedScore.toFixed(4)
        } (threshold: ${threshold}) — [${perCriterionSummary}]`,
        evidence_refs: llmJudgeEvidenceRefs(criterion),
        score: weightedScore,
        score_weight: options.criterion.score_weight,
        ...(judgeResult(judgeProvenance, "mock pass") ? { judge: judgeResult(judgeProvenance, "mock pass") } : {}),
      };
    }
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.PASSED,
      message: `LLM judge (${criterion.preset ?? "inline rubric"}): mock pass (threshold: ${threshold})`,
      evidence_refs: llmJudgeEvidenceRefs(criterion),
      score: 1.0,
      score_weight: options.criterion.score_weight,
      ...(judgeResult(judgeProvenance, "mock pass") ? { judge: judgeResult(judgeProvenance, "mock pass") } : {}),
    };
  }

  // EXA_EVAL_LLM_MOCK=false → real LLM call
  try {
    const judgeJsonSchema = isMulti ? getEvaluationResultJsonSchema() : getCriterionResultJsonSchema();
    const calibrationCapture = resolveEffectiveCalibrationCapture(
      options.calibrationCapture,
      criterion.id,
      options.workspaceRoot,
    );
    const captureObserver = calibrationCapture
      ? async (resolved: ILlmEndpointResolvedMetadata) => {
        await calibrationCapture({
          requestContext: contextWithTests ?? "",
          artifact: content,
          rubricMethodology: methodology,
          provider: resolved.provider,
          model: resolved.model,
          promptUsed,
          rawResponse: resolved.result.content,
        });
      }
      : undefined;
    const rawLlmResponse = await callLlmEndpoint(promptUsed, options.env, judgeJsonSchema, captureObserver);
    const cleaned = rawLlmResponse.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    if (isMulti) {
      const parsed = EvaluationResultSchema.parse(JSON.parse(cleaned));
      const weightedScore = calculateWeightedScore(parsed.criteriaScores, effectiveCriteria);
      const passed = weightedScore >= threshold;
      const perCriterionSummary = effectiveCriteria.map((c) =>
        `${c.name}: ${parsed.criteriaScores[c.name]?.score.toFixed(2) ?? "N/A"}`
      ).join("; ");
      // Capture the judge's per-criterion reasoning so the run artifact proves it reasoned over
      // the supplied evidence (the worktree diff), not a bare score.
      const reasoning = effectiveCriteria
        .map((c) => `${c.name}: ${parsed.criteriaScores[c.name]?.reasoning ?? "(no reasoning)"}`)
        .join(" | ");
      console.error(`[eval] preset="${criterion.preset}" weighted=${weightedScore.toFixed(4)} passed=${passed}`);
      return {
        criterion_id: criterion.id,
        kind: CriterionKind.LLM_JUDGE,
        phase: options.phase,
        status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
        message: `LLM judge preset "${criterion.preset}": weighted score ${
          weightedScore.toFixed(4)
        } (threshold: ${threshold}) — [${perCriterionSummary}]`,
        evidence_refs: llmJudgeEvidenceRefs(criterion),
        observed_value: weightedScore,
        expected_value: threshold,
        score: weightedScore,
        score_weight: options.criterion.score_weight,
        ...(judgeResult(judgeProvenance, reasoning) ? { judge: judgeResult(judgeProvenance, reasoning) } : {}),
      };
    }

    const parsed = JudgeResponseSchema.parse(JSON.parse(cleaned));
    const score = parsed.score;
    const passed = score >= threshold;
    console.error(
      `[eval] size=${options.env?.EXA_EVAL_MODEL_SIZE ?? Deno.env.get("EXA_EVAL_MODEL_SIZE") ?? "-"} provider=${
        judgeProvenance?.provider ?? "(auto)"
      } score=${score.toFixed(2)} passed=${passed}`,
    );

    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      message: `LLM judge score: ${score.toFixed(2)} (threshold: ${threshold})`,
      evidence_refs: llmJudgeEvidenceRefs(criterion),
      observed_value: score,
      expected_value: threshold,
      score: score,
      score_weight: options.criterion.score_weight,
      ...(judgeResult(judgeProvenance, parsed.reasoning)
        ? { judge: judgeResult(judgeProvenance, parsed.reasoning) }
        : {}),
    };
  } catch (err) {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.ERROR,
      message: `LLM judge: failed to parse LLM response: ${(err as Error).message}`,
      evidence_refs: [],
      score_weight: options.criterion.score_weight,
    };
  }
}

// ProviderFactory.resolveOptionsByName resolves a generic `timeoutMs` (30s, sized for HTTP)
// before CliDelegateProviderFactory.create() runs, so its own 300s CLI default never applies
// once that's already set. A real opencode eval-judge call live-timed-out at exactly 30000ms.
export function resolveEvalLlmTimeoutMs(provider: string): number | undefined {
  return provider === ProviderType.CLAUDE_CLI || provider === ProviderType.OPENCODE_CLI
    ? DEFAULT_CLI_DELEGATE_TIMEOUT_MS
    : undefined;
}

// A hardcoded "/tmp/exa-eval" `system.root` doesn't exist, and CliDelegateProviderFactory uses
// it as the CLI subprocess's cwd, so every claude-cli/opencode-cli judge call failed to spawn.
// `Deno.cwd()` always exists; non-CLI providers never read this field, so it's safe for all.
export function resolveEvalLlmJudgeConfigRoot(): string {
  return Deno.cwd();
}

export async function callLlmEndpoint(
  prompt: string,
  stepEnv?: Opt<{ [key: string]: string }, Reason.OptionalInput>,
  jsonSchema?: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  onResolved?: Opt<(metadata: ILlmEndpointResolvedMetadata) => void | Promise<void>, Reason.OptionalDependency>,
): Promise<string> {
  // Step env (options.env) takes precedence over the runner's process env — reading only
  // Deno.env here silently ignored a step-declared EXA_EVAL_LLM_MOCK/EXA_LLM_PROVIDER and
  // fell through to the MockLLMProvider.
  const readEnv = (key: string): string | undefined => stepEnv?.[key] ?? Deno.env.get(key);
  // Dedicated judge vars (EXA_EVAL_LLM_*) win over the scenario's own model (EXA_LLM_*) so a
  // run can grade with a different model than it executes with — consistent with
  // resolveEvalJudgeProvenance.
  const envProvider = readEnv("EXA_EVAL_LLM_PROVIDER") ?? readEnv("EXA_LLM_PROVIDER");
  const envModel = readEnv("EXA_EVAL_LLM_MODEL") ?? readEnv("EXA_LLM_MODEL");
  const envEvalModelSize = readEnv("EXA_EVAL_MODEL_SIZE");
  const envEvalCharacteristics = readEnv("EXA_EVAL_CHARACTERISTICS");
  const useRealLlm = readEnv("EXA_EVAL_LLM_MOCK") === "false";

  // Real LLM calls require an explicit provider
  if (useRealLlm && !envProvider) {
    throw new Error(
      "EXA_LLM_PROVIDER (or EXA_EVAL_LLM_PROVIDER) is required when EXA_EVAL_LLM_MOCK=false. " +
        "Set it to a supported provider (e.g. 'ollama', 'anthropic', 'opencode-cli').",
    );
  }

  // Ensure provider registry and defaults are initialized
  bootstrapProviderRegistry();

  // Build the resolution intent from environment variables
  const intent: IModelIntent = {};
  if (envProvider) intent.preferred_provider = envProvider;
  if (envModel) {
    // Provider:model format or bare name — both handled by ModelResolver
    intent.model = envModel;
  } else if (envProvider) {
    // Bare provider name → ModelResolver resolves via registry metadata
    intent.model = envProvider;
  }
  if (envEvalModelSize) {
    const valid = ["S", "M", "L", "XL"];
    if (valid.includes(envEvalModelSize)) {
      intent.model_size = envEvalModelSize as ModelSize;
    }
  }
  if (envEvalCharacteristics) {
    intent.characteristics = envEvalCharacteristics.split(",").map((s) => s.trim());
  }
  intent.allow_local = true;
  intent.required_capabilities = ["chat"];

  // Inline stubs — no DB, no daemon dependencies
  const healthChecker: IProviderHealthChecker = {
    checkProvider: () => Promise.resolve(true),
  };
  const costTracker: ICostTracker = {
    trackGeneration: () => Promise.resolve(0),
    persistEntry: () => Promise.resolve(),
    queryByCriteria: () => Promise.resolve([]),
    getTotalCost: () => 0,
    getDailyCost: () => Promise.resolve(0),
    flush: () => Promise.resolve(),
    isWithinBudget: () => Promise.resolve(true),
  };
  const eventLogger = createMockEventLogger();
  const config = createMockConfig(resolveEvalLlmJudgeConfigRoot(), {
    model_presets: DEFAULT_MODEL_PRESETS,
  });

  const resolver = new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, costTracker, healthChecker),
    config,
    healthChecker,
    eventLogger,
    undefined, // no modelRegistry — rely on resolvePresetFromSize with actual presets
    undefined, // Solo — no Team strategy
  );

  let resolved: IResolvedModel;
  try {
    resolved = await resolver.resolve(intent);
  } catch (err) {
    throw new Error(
      `Model resolution failed: ${(err as Error).message}. ` +
        `Set EXA_LLM_PROVIDER and optionally EXA_EVAL_MODEL_SIZE.`,
    );
  }

  const cliDelegateTimeoutMs = resolveEvalLlmTimeoutMs(resolved.provider);
  const overrides: Partial<Config> = {
    models: {
      default: { provider: resolved.provider, model: resolved.model },
    },
    ...(cliDelegateTimeoutMs
      ? {
        // Without an explicit `ai`, AiConfigSchema's own 30s default wins in
        // resolveOptionsByName before ai_timeout.providers is ever read — a real CLI call
        // silently timed out at 30s despite the override below until `ai` was set directly.
        ai: { provider: resolved.provider, model: resolved.model, timeout_ms: cliDelegateTimeoutMs },
        ai_timeout: { default_ms: cliDelegateTimeoutMs, providers: { [resolved.provider]: cliDelegateTimeoutMs } },
      }
      : {}),
  };
  const finalConfig = createMockConfig(
    resolveEvalLlmJudgeConfigRoot(),
    overrides as Parameters<typeof createMockConfig>[1],
  );
  const provider = await ProviderFactory.createByName(finalConfig, "default");
  const result = await provider.generate(prompt, {
    ...resolved.options,
    ...(jsonSchema !== undefined ? { jsonSchema } : {}),
  });
  if (onResolved) {
    await onResolved({ provider: resolved.provider, model: resolved.model, result });
  }
  return result.content;
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] < bParts[i]) return -1;
    if (aParts[i] > bParts[i]) return 1;
  }

  return 0;
}
