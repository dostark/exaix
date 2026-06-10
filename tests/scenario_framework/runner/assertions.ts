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

import { globToRegExp, isAbsolute, relative, resolve } from "@std/path";
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
import type { JSONValue } from "@exaix/core/types";
import type { IScenarioStepExecutionResult } from "./step_executor.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import { buildEvaluationPrompt, CriterionResultSchema, getCriteriaByNames } from "@exaix/core/evaluation";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const JSON_PATH_ROOT = "$";

interface IJournalEvent {
  event_type?: string;
  action_type?: string;
  [key: string]: any;
}

export enum StepFailureStage {
  INPUT = "input",
  EXECUTION = "execution",
  OUTPUT = "output",
}

export interface IEvaluateCriterionOptions {
  workspaceRoot: string;
  phase: CriterionPhase;
  criterion: ICriterion;
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  exactlExecutable?: string;
}

export interface IEvaluateStepOutcomeOptions {
  workspaceRoot: string;
  step: IScenarioStep;
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  verbose?: boolean;
  exactlExecutable?: string;
}

export interface IScenarioStepOutcome {
  stepId: string;
  status: CriterionStatus;
  failureStage: CriterionPhase | StepFailureStage.EXECUTION | null;
  criterionResults: ICriterionResult[];
  executionResult?: IScenarioStepExecutionResult;
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
    case CriterionKind.LLM_JUDGE:
      return await evaluateLlmJudgeCriterion(options);
  }
}

export async function evaluateStepOutcome(
  options: IEvaluateStepOutcomeOptions,
): Promise<IScenarioStepOutcome> {
  // Trajectory-assert steps don't use traditional criteria — results come from the executor
  if (options.step.type === ScenarioStepType.TRAJECTORY_ASSERT) {
    const stdout = options.executionResult?.stdout ?? "";
    const exitCode = options.executionResult?.exitCode ?? 0;
    const allPassed = exitCode === 0;
    return {
      stepId: options.step.id,
      status: allPassed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      failureStage: allPassed ? null : StepFailureStage.EXECUTION,
      criterionResults: [
        {
          criterion_id: "trajectory-sequence",
          kind: CriterionKind.COMMAND_EXIT_CODE,
          phase: CriterionPhase.OUTPUT,
          status: allPassed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
          message: stdout || "trajectory assertion completed",
          evidence_refs: [],
        },
      ],
      executionResult: options.executionResult,
    };
  }
  // Resolve file_pattern if provided by the step
  let stepTargetFile: string | undefined = undefined;
  if (options.step.file_pattern) {
    stepTargetFile = await resolveStepFilePattern(
      options.workspaceRoot,
      options.step.file_pattern,
    );
  }

  // Rewrite criteria if step-level target file is resolved
  const inputCriteria = stepTargetFile
    ? rewriteCriteriaWithTarget(options.step.input_criteria, stepTargetFile)
    : options.step.input_criteria;

  const outputCriteria = stepTargetFile
    ? rewriteCriteriaWithTarget(options.step.output_criteria, stepTargetFile)
    : options.step.output_criteria;

  const inputResults = await evaluateCriteriaBatch({
    workspaceRoot: options.workspaceRoot,
    phase: CriterionPhase.INPUT,
    criteria: inputCriteria,
    executionResult: options.executionResult,
    env: options.env,
    portalAliases: options.portalAliases,
    exactlExecutable: options.exactlExecutable,
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

  if ((options.executionResult?.exitCode ?? 0) !== 0) {
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
    phase: CriterionPhase.OUTPUT,
    criteria: outputCriteria,
    executionResult: options.executionResult,
    env: options.env,
    portalAliases: options.portalAliases,
    exactlExecutable: options.exactlExecutable,
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
  phase: CriterionPhase;
  criteria: ICriterion[];
  executionResult?: IScenarioStepExecutionResult;
  env?: { [key: string]: string };
  portalAliases?: string[];
  exactlExecutable?: string;
}

async function evaluateCriteriaBatch(
  options: IEvaluateCriteriaBatchOptions,
): Promise<ICriterionResult[]> {
  const results: ICriterionResult[] = [];

  for (const criterion of options.criteria) {
    results.push(
      await evaluateCriterion({
        workspaceRoot: options.workspaceRoot,
        phase: options.phase,
        criterion,
        executionResult: options.executionResult,
        env: options.env,
        portalAliases: options.portalAliases,
        exactlExecutable: options.exactlExecutable,
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
  const evidenceRefs = buildEvidenceRefs(options.workspaceRoot, criterion.path);

  try {
    await Deno.stat(resolveCriterionPath(options.workspaceRoot, criterion.path));
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
  for await (const filePath of walkWorkspaceFiles(options.workspaceRoot)) {
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

  try {
    await Deno.stat(resolveCriterionPath(options.workspaceRoot, criterion.path));
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
  const content = await safeReadTextFile(options.workspaceRoot, criterion.path);

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
  const content = await safeReadTextFile(options.workspaceRoot, criterion.path);

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
  const found = events.some((
    e,
  ) => (e.action_type === criterion.event_type || e.event_type === criterion.event_type));

  if (found) {
    return buildPassedResult(options, []);
  }

  return buildFailedResult(options, {
    message: `expected journal event type: ${criterion.event_type}`,
    expectedValue: criterion.event_type,
    observedValue: `Latest 50 events: ${events.slice(0, 50).map((e) => e.action_type || e.event_type).join(", ")}`,
  });
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
  };
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

function buildEvidenceRefs(workspaceRoot: string, relativePath?: string): string[] {
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
  targetFile?: string,
): Promise<unknown | null> {
  if (!targetFile) {
    return null;
  }

  const content = await safeReadTextFile(workspaceRoot, targetFile);
  return content === null ? null : JSON.parse(content);
}

async function loadFrontmatterDocument(
  workspaceRoot: string,
  targetFile?: string,
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

function valuesMatch(left: any, right: any, similarityThreshold?: number): boolean {
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

async function resolveStepFilePattern(
  workspaceRoot: string,
  pattern: string,
): Promise<string | undefined> {
  const matcher = globToRegExp(pattern);
  for await (const filePath of walkWorkspaceFiles(workspaceRoot)) {
    const relativePath = relative(workspaceRoot, filePath);
    if (matcher.test(relativePath)) {
      return relativePath;
    }
  }
  return undefined;
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

// -----------------------------------------------------------------------------
// Version Assertion Criteria (Phase 51 Secondary Goal)
// -----------------------------------------------------------------------------

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

function evaluateJsonQueryCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as IJsonQueryCriterion;
  // For JSON query, we evaluate against the stdout of the command (e.g., journal query output)
  const outputData = options.executionResult?.stdout || "{}";

  try {
    const data = JSON.parse(outputData);

    // Execute the query using a simple JSON path evaluation
    const queryParts = criterion.query.split(".");
    let result: any = data;

    for (const part of queryParts) {
      if (part === "[]" || part === "[*]") {
        result = Array.isArray(result) ? result : [result];
      } else if (part.startsWith("[") && part.endsWith("]")) {
        const index = parseInt(part.slice(1, -1), 10);
        result = Array.isArray(result) ? result[index] : undefined;
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
      const resultStr = JSON.stringify(result);
      passed = criterion.contains.every((v) => resultStr.includes(v));
      message = passed
        ? `JSON query "${criterion.query}" contains all specified values`
        : `JSON query "${criterion.query}" result does not contain all specified values`;
    } else if (criterion.not_empty) {
      passed = result !== undefined && result !== null && result !== "";
      message = passed
        ? `JSON query "${criterion.query}" returned non-empty value`
        : `JSON query "${criterion.query}" returned empty value`;
    } else if (criterion.min !== undefined) {
      const length = Array.isArray(result) ? result.length : typeof result === "string" ? result.length : 0;
      passed = length >= criterion.min;
      message = passed
        ? `JSON query "${criterion.query}" returned ${length} items (>= ${criterion.min})`
        : `JSON query "${criterion.query}" returned ${length} items, expected >= ${criterion.min}`;
    } else if (criterion.max !== undefined) {
      const length = Array.isArray(result) ? result.length : typeof result === "string" ? result.length : 0;
      passed = length <= criterion.max;
      message = passed
        ? `JSON query "${criterion.query}" returned ${length} items (<= ${criterion.max})`
        : `JSON query "${criterion.query}" returned ${length} items, expected <= ${criterion.max}`;
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

async function evaluateLlmJudgeCriterion(
  options: IEvaluateCriterionOptions,
): Promise<ICriterionResult> {
  const criterion = options.criterion as ICriterion & {
    evidence_path?: string;
    preset?: string;
    rubric?: string;
    score_threshold?: number;
  };

  // Validate: at least one of preset or rubricequired
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

  // Resolve preset criteria if specified
  const presetCriteria = criterion.preset ? getCriteriaByNames([criterion.preset]) : [];
  const effectiveCriteria = presetCriteria;

  // Read evidence content
  let content = "";
  if (criterion.evidence_path) {
    const resolvedPath = resolve(options.workspaceRoot, criterion.evidence_path);
    try {
      content = await Deno.readTextFile(resolvedPath);
    } catch {
      content = options.executionResult?.stdout ?? "";
    }
  } else {
    content = options.executionResult?.stdout ?? "";
  }

  const promptUsed = buildEvaluationPrompt(content, effectiveCriteria, criterion.rubric);
  const threshold = criterion.score_threshold ?? 0.7;

  // In test/CI mode without an LLM endpoint, return a mock pass result
  // Set EXA_EVAL_LLM_MOCK=false to fail when no LLM is configured
  const useMock = Deno.env.get("EXA_EVAL_LLM_MOCK") !== "false";
  if (useMock) {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.PASSED,
      message: `LLM judge (${criterion.preset ?? "inline rubric"}): mock pass (threshold: ${threshold})`,
      evidence_refs: criterion.evidence_path ? [criterion.evidence_path] : [],
      score_weight: options.criterion.score_weight,
    };
  }

  // When LLM endpoint is configured, parse the real response
  try {
    const rawLlmResponse = await callLlmEndpoint(promptUsed);
    const parsed = CriterionResultSchema.parse(JSON.parse(rawLlmResponse));
    const score = parsed.score;
    const passed = score >= threshold;

    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: passed ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      message: `LLM judge score: ${score.toFixed(2)} (threshold: ${threshold})`,
      evidence_refs: criterion.evidence_path ? [criterion.evidence_path] : [],
      observed_value: score,
      expected_value: threshold,
      score_weight: options.criterion.score_weight,
    };
  } catch {
    return {
      criterion_id: criterion.id,
      kind: CriterionKind.LLM_JUDGE,
      phase: options.phase,
      status: CriterionStatus.ERROR,
      message: "LLM judge: failed to parse LLM response",
      evidence_refs: [],
      score_weight: options.criterion.score_weight,
    };
  }
}

export async function callLlmEndpoint(prompt: string): Promise<string> {
  const provider = (Deno.env.get("EXA_LLM_PROVIDER") ?? "").toLowerCase().trim();

  // Backward compatibility: ANTHROPIC_API_KEY without explicit provider routes to Anthropic
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!provider && anthropicKey) {
    return callAnthropicEndpoint(prompt, anthropicKey);
  }

  switch (provider) {
    case "anthropic": {
      const key = anthropicKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!key) throw new Error("EXA_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
      return await callAnthropicEndpoint(prompt, key);
    }
    case "openai": {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) throw new Error("EXA_LLM_PROVIDER=openai requires OPENAI_API_KEY");
      return await callOpenAIEndpoint(prompt, key);
    }
    case "google": {
      const key = Deno.env.get("GOOGLE_API_KEY");
      if (!key) throw new Error("EXA_LLM_PROVIDER=google requires GOOGLE_API_KEY");
      return await callGoogleEndpoint(prompt, key);
    }
    case "openrouter": {
      const key = Deno.env.get("OPENROUTER_API_KEY");
      if (!key) throw new Error("EXA_LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY");
      return await callOpenRouterEndpoint(prompt, key);
    }
    case "ollama":
    case "":
      return await callOllamaEndpoint(prompt);
    default:
      throw new Error(
        `Unknown EXA_LLM_PROVIDER="${provider}". Supported values: anthropic, openai, google, openrouter, ollama`,
      );
  }
}

async function callAnthropicEndpoint(prompt: string, apiKey: string): Promise<string> {
  const endpoint = Deno.env.get("EXA_LLM_ENDPOINT") ?? "https://api.anthropic.com/v1/messages";
  const model = Deno.env.get("EXA_LLM_MODEL") ?? "claude-haiku-4-5-20251001";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${data.error?.message ?? response.statusText}`);
    }
    const text = data.content?.[0]?.text ?? JSON.stringify(data);
    return text;
  } catch (error) {
    throw new Error(`Anthropic LLM call failed: ${(error as Error).message}`);
  }
}

async function callOpenAIEndpoint(prompt: string, apiKey: string): Promise<string> {
  const endpoint = Deno.env.get("EXA_LLM_ENDPOINT") ?? "https://api.openai.com/v1/chat/completions";
  const model = Deno.env.get("EXA_LLM_MODEL") ?? "gpt-4o-mini";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${data.error?.message ?? response.statusText}`);
    }
    const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return text;
  } catch (error) {
    throw new Error(`OpenAI LLM call failed: ${(error as Error).message}`);
  }
}

async function callGoogleEndpoint(prompt: string, apiKey: string): Promise<string> {
  const model = Deno.env.get("EXA_LLM_MODEL") ?? "gemini-2.0-flash";
  const baseUrl = Deno.env.get("EXA_LLM_ENDPOINT") ??
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  try {
    const url = baseUrl.includes("?") ? `${baseUrl}&key=${apiKey}` : `${baseUrl}?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Google API error: ${data.error?.message ?? response.statusText}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
    return text;
  } catch (error) {
    throw new Error(`Google LLM call failed: ${(error as Error).message}`);
  }
}

async function callOpenRouterEndpoint(prompt: string, apiKey: string): Promise<string> {
  const endpoint = Deno.env.get("EXA_LLM_ENDPOINT") ?? "https://openrouter.ai/api/v1/chat/completions";
  const model = Deno.env.get("EXA_LLM_MODEL") ?? "openrouter/auto";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${data.error?.message ?? response.statusText}`);
    }
    const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return text;
  } catch (error) {
    throw new Error(`OpenRouter LLM call failed: ${(error as Error).message}`);
  }
}

async function callOllamaEndpoint(prompt: string): Promise<string> {
  const endpoint = Deno.env.get("EXA_LLM_ENDPOINT") ?? "http://127.0.0.1:11434/api/generate";
  const model = Deno.env.get("EXA_LLM_MODEL") ?? "llama3";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    const data = await response.json();
    return data.response ?? JSON.stringify(data);
  } catch (error) {
    throw new Error(`LLM call failed: ${(error as Error).message}`);
  }
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
