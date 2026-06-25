/**
 * @module ScenarioFrameworkStepSchema
 * @path tests/scenario_framework/schema/step_schema.ts
 * @description Defines the Step 1 Zod contracts for scenario steps,
 * criteria, portal declarations, and criterion result payloads used by the
 * scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/config.ts, tests/scenario_framework/tests/unit/framework_contract_test.ts]
 */

import { z } from "zod";
import { VERSION_PATTERN } from "./version.ts";

const NON_EMPTY_STRING = z.string().min(1);

export enum ScenarioExecutionMode {
  AUTO = "auto",
  STEP = "step",
  MANUAL_CHECKPOINT = "manual-checkpoint",
}

export enum ScenarioStepType {
  SHELL = "shell",
  EXACTL = "exactl",
  WAIT_FOR_FILE = "wait-for-file",
  WAIT_FOR_STATUS = "wait-for-status",
  WAIT_FOR_JSON_FIELD = "wait-for-json-field",
  JOURNAL_ASSERT = "journal-assert",
  FRONTMATTER_ASSERT = "frontmatter-assert",
  FILE_CONTAINS = "file-contains",
  JSON_ASSERT = "json-assert",
  MANUAL_REVIEW = "manual-review",
  CLEANUP = "cleanup",
  TRAJECTORY_ASSERT = "trajectory-assert",
}

export enum CriterionKind {
  FILE_EXISTS = "file-exists",
  FILE_FOUND = "file-found",
  FILE_NOT_EXISTS = "file-not-exists",
  TEXT_CONTAINS = "text-contains",
  JSON_PATH_EXISTS = "json-path-exists",
  JSON_PATH_EQUALS = "json-path-equals",
  JSON_PATH_EQUALS_ANY = "json-path-equals-any",
  JSON_QUERY = "json-query",
  FRONTMATTER_FIELD_EXISTS = "frontmatter-field-exists",
  FRONTMATTER_FIELD_EQUALS = "frontmatter-field-equals",
  JOURNAL_EVENT_EXISTS = "journal-event-exists",
  COMMAND_EXIT_CODE = "command-exit-code",
  STATUS_EQUALS = "status-equals",
  PORTAL_MOUNTED = "portal-mounted",
  ENV_VAR_PRESENT = "env-var-present",
  TEXT_MATCHES = "text-matches",
  VERSION_EQUALS = "version-equals",
  VERSION_GTE = "version-gte",
  VERSION_LTE = "version-lte",
  DIR_EXISTS = "dir-exists",
  COMMAND_OUTPUT_CONTAINS = "command-output-contains",
  LLM_JUDGE = "llm-judge",
}

export enum CriterionPhase {
  INPUT = "input",
  OUTPUT = "output",
}

export enum CriterionStatus {
  PASSED = "passed",
  FAILED = "failed",
  SKIPPED = "skipped",
  ERROR = "error",
  TIMEOUT = "timeout",
  BLOCKED = "blocked",
}

const ScenarioExecutionModeSchema = z.nativeEnum(ScenarioExecutionMode);
const ScenarioStepTypeSchema = z.nativeEnum(ScenarioStepType);
const CriterionKindSchema = z.nativeEnum(CriterionKind);
const CriterionPhaseSchema = z.nativeEnum(CriterionPhase);
const CriterionStatusSchema = z.nativeEnum(CriterionStatus);

export const PortalMountSchema = z.object({
  alias: NON_EMPTY_STRING,
  source_path: z.string().min(1),
}).strict();

export type IPortalMount = z.infer<typeof PortalMountSchema>;

const BaseCriterionSchema = z.object({
  id: NON_EMPTY_STRING,
  kind: CriterionKindSchema,
  message: z.string().min(1).optional(),
  score_weight: z.number().min(0).max(1).optional(),
});

const FileExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_EXISTS),
  path: NON_EMPTY_STRING,
}).strict();

const FileFoundCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_FOUND),
  path_pattern: NON_EMPTY_STRING,
}).strict();

const FileNotExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_NOT_EXISTS),
  path: NON_EMPTY_STRING,
}).strict();

const TextContainsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.TEXT_CONTAINS),
  path: NON_EMPTY_STRING,
  contains: NON_EMPTY_STRING,
  similarity_threshold: z.number().min(0).max(1).optional(),
}).strict();

const JsonPathExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.JSON_PATH_EXISTS),
  path: NON_EMPTY_STRING,
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const JsonPathEqualsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.JSON_PATH_EQUALS),
  path: NON_EMPTY_STRING,
  equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  similarity_threshold: z.number().min(0).max(1).optional(),
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const JsonPathEqualsAnyCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.JSON_PATH_EQUALS_ANY),
  path: NON_EMPTY_STRING,
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1),
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const JsonQueryCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.JSON_QUERY),
  query: NON_EMPTY_STRING,
  equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  contains: z.array(z.string()).min(1).optional(),
  not_empty: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unique_count_min: z.number().optional(),
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const DirExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.DIR_EXISTS),
  path: NON_EMPTY_STRING,
}).strict();

const FrontmatterFieldExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FRONTMATTER_FIELD_EXISTS),
  field: NON_EMPTY_STRING,
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const FrontmatterFieldEqualsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FRONTMATTER_FIELD_EQUALS),
  field: NON_EMPTY_STRING,
  equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  similarity_threshold: z.number().min(0).max(1).optional(),
  target_file: NON_EMPTY_STRING.optional(),
}).strict();

const JournalEventExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.JOURNAL_EVENT_EXISTS),
  event_type: NON_EMPTY_STRING,
  journal_file: NON_EMPTY_STRING.optional(),
  // Phase 127 Step 7: when set, a matching event must exist whose parsed `payload` does NOT
  // carry every one of these key/value pairs. Distinguishes an ACCEPTED reconcile from a
  // non-scope-rejected one (both emit session.delegate.reconciled) — see assertions.ts.
  payload_absent: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

const CommandExitCodeCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.COMMAND_EXIT_CODE),
  equals: z.number().int(),
}).strict();

const CommandOutputContainsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.COMMAND_OUTPUT_CONTAINS),
  contains: z.array(z.string()).min(1),
}).strict();

const StatusEqualsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.STATUS_EQUALS),
  equals: NON_EMPTY_STRING,
}).strict();

const PortalMountedCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.PORTAL_MOUNTED),
  alias: NON_EMPTY_STRING,
}).strict();

const EnvVarPresentCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.ENV_VAR_PRESENT),
  env_var: NON_EMPTY_STRING,
}).strict();

const TextMatchesCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.TEXT_MATCHES),
  path: NON_EMPTY_STRING,
  matches: z.array(NON_EMPTY_STRING).min(1),
  flags: z.string().optional(),
}).strict();

const VersionEqualsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.VERSION_EQUALS),
  version: NON_EMPTY_STRING,
  source: z.enum(["binary", "workspace"]).default("binary"),
}).strict();

const VersionGteCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.VERSION_GTE),
  version: NON_EMPTY_STRING,
  source: z.enum(["binary", "workspace"]).default("binary"),
}).strict();

const VersionLteCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.VERSION_LTE),
  version: NON_EMPTY_STRING,
  source: z.enum(["binary", "workspace"]).default("binary"),
}).strict();

export const ExpectedSequenceEntrySchema = z.object({
  tool: NON_EMPTY_STRING,
  args_contains: z.array(z.string().min(1)).optional(),
  min_args: z.number().int().min(0).optional(),
  max_args: z.number().int().min(0).optional(),
}).strict();

export type IExpectedSequenceEntry = z.infer<typeof ExpectedSequenceEntrySchema>;

const LlmJudgeCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.LLM_JUDGE),
  evidence_path: z.string().min(1).optional(),
  preset: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
  score_threshold: z.number().min(0).max(1).default(0.7),
}).strict();

export const CriterionSchema = z.discriminatedUnion("kind", [
  FileExistsCriterionSchema,
  FileFoundCriterionSchema,
  FileNotExistsCriterionSchema,
  TextContainsCriterionSchema,
  JsonPathExistsCriterionSchema,
  JsonPathEqualsCriterionSchema,
  JsonPathEqualsAnyCriterionSchema,
  JsonQueryCriterionSchema,
  DirExistsCriterionSchema,
  FrontmatterFieldExistsCriterionSchema,
  FrontmatterFieldEqualsCriterionSchema,
  JournalEventExistsCriterionSchema,
  CommandExitCodeCriterionSchema,
  StatusEqualsCriterionSchema,
  PortalMountedCriterionSchema,
  EnvVarPresentCriterionSchema,
  TextMatchesCriterionSchema,
  VersionEqualsCriterionSchema,
  VersionGteCriterionSchema,
  VersionLteCriterionSchema,
  CommandOutputContainsCriterionSchema,
  LlmJudgeCriterionSchema,
]);

export type ICriterion = z.infer<typeof CriterionSchema>;

export const CriterionResultSchema = z.object({
  criterion_id: NON_EMPTY_STRING,
  kind: CriterionKindSchema,
  phase: CriterionPhaseSchema,
  status: CriterionStatusSchema,
  message: NON_EMPTY_STRING,
  evidence_refs: z.array(z.string().min(1)),
  observed_value: z.unknown().optional(),
  expected_value: z.unknown().optional(),
  score_weight: z.number().min(0).max(1).optional(),
}).strict();

export type ICriterionResult = z.infer<typeof CriterionResultSchema>;

export const ScenarioStepSchema = z.object({
  id: NON_EMPTY_STRING,
  type: ScenarioStepTypeSchema,
  name: NON_EMPTY_STRING.optional(),
  command: NON_EMPTY_STRING.optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout_sec: z.number().int().positive().optional(),
  checkpoint: z.union([NON_EMPTY_STRING, z.boolean()]).optional(),
  instructions: NON_EMPTY_STRING.optional(),
  continue_on_failure: z.boolean().default(false),
  expect_failure: z.boolean().optional(),
  artifact_refs: z.array(z.string().min(1)).optional(),
  file_pattern: z.string().min(1).optional(),
  input_criteria: z.array(CriterionSchema).optional().default([]),
  output_criteria: z.array(CriterionSchema).optional().default([]),
  step_weight: z.number().min(0).max(1).optional(),
  source_step: z.string().min(1).optional(),
  expected_sequence: z.array(ExpectedSequenceEntrySchema).optional(),
  order_matters: z.boolean().optional(),
  allow_extra_tools: z.boolean().optional(),
  partial_credit: z.boolean().optional(),
}).superRefine((step, ctx) => {
  if (step.type === ScenarioStepType.MANUAL_REVIEW && !step.instructions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "manual-review steps require instructions",
      path: ["instructions"],
    });
  }

  if (step.type === ScenarioStepType.EXACTL && !step.command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactl steps require a command",
      path: ["command"],
    });
  }

  if (step.type === ScenarioStepType.TRAJECTORY_ASSERT) {
    if (!step.source_step) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trajectory-assert steps require source_step",
        path: ["source_step"],
      });
    }
    if (!step.expected_sequence || step.expected_sequence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trajectory-assert steps require non-empty expected_sequence",
        path: ["expected_sequence"],
      });
    }
  }

  // Validate llm-judge criteria have preset or rubric
  for (const criterion of [...(step.input_criteria ?? []), ...(step.output_criteria ?? [])]) {
    if (criterion.kind === CriterionKind.LLM_JUDGE && !criterion.preset && !criterion.rubric) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "llm-judge criteria require either 'preset' or 'rubric'",
        path: [criterion.id],
      });
    }
  }
});

export type IScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioSchemaVersionSchema = z.string().regex(VERSION_PATTERN);

export type IScenarioExecutionMode = z.infer<typeof ScenarioExecutionModeSchema>;
