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
  TEST_RUN = "test-run",
  PATCH_BLUEPRINT = "patch-blueprint",
  PREPARE_EVIDENCE = "prepare-evidence",
  WRITE_FILE = "write-file",
  REMOVE_FILES = "remove-files",
  RUN_SCRIPT = "run-script",
  JUDGE = "judge",
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
  COMMAND_OUTPUT_NOT_CONTAINS = "command-output-not-contains",
  LLM_JUDGE = "llm-judge",
  TRAJECTORY = "trajectory",
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

/** Optional marker classifying a criterion's intent (Phase 143 Step 3). A `class: security`
 *  criterion failure gates the whole suite under `scoring: gated` (Harness-Bench
 *  Security·Completion·Process semantics). Declared here — not in runner/scoring.ts — because
 *  scoring.ts already imports `CriterionStatus` as a value from this module; putting the enum
 *  here keeps the schema→scoring edge one-directional (no runtime import cycle). */
export enum CriterionClass {
  SECURITY = "security",
}

const ScenarioExecutionModeSchema = z.nativeEnum(ScenarioExecutionMode);
const ScenarioStepTypeSchema = z.nativeEnum(ScenarioStepType);
const CriterionKindSchema = z.nativeEnum(CriterionKind);
const CriterionPhaseSchema = z.nativeEnum(CriterionPhase);
const CriterionStatusSchema = z.nativeEnum(CriterionStatus);
const CriterionClassSchema = z.nativeEnum(CriterionClass);

export const PortalMountSchema = z.object({
  alias: NON_EMPTY_STRING,
  source_path: z.string().min(1),
  /** When set, the fixture at `source_path` is clean-staged into this workspace path (the
   *  runner removes any prior target, stale worktrees, and stale symlink first) and the
   *  portal is mounted there. The runner owns reset + copy, so an evaluated repo can never
   *  leak a previous scenario's/cell's changes. Absent → `source_path` is mounted directly. */
  target_path: z.string().min(1).optional(),
  /** Initialize a git repo (with an initial commit) in `target_path` after the fixture copy. */
  git_init: z.boolean().optional(),
}).strict();

export type IPortalMount = z.infer<typeof PortalMountSchema>;

const BaseCriterionSchema = z.object({
  id: NON_EMPTY_STRING,
  kind: CriterionKindSchema,
  message: z.string().min(1).optional(),
  score_weight: z.number().min(0).max(1).optional(),
  /** Optional classification marker (Phase 143 Step 3). `class: "security"` marks a
   *  scope-violation / path-escape / approval-bypass criterion whose failure gates the
   *  suite under `scoring: gated`. */
  class: CriterionClassSchema.optional(),
});

const FileExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_EXISTS),
  path: z.string().optional(),
}).strict();

const FileFoundCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_FOUND),
  path_pattern: NON_EMPTY_STRING,
}).strict();

const FileNotExistsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.FILE_NOT_EXISTS),
  path: z.string().optional(),
}).strict();

const TextContainsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.TEXT_CONTAINS),
  path: z.string().optional(),
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
  // Phase 142 Step 17: when set, a matching event must exist whose parsed `payload` carries,
  // under each named key, an ARRAY containing every listed string. Membership rather than
  // equality, so a criterion can pin the ids it cares about out of e.g. `skills.resolved`'s
  // `skill_ids` without restating the whole resolved set — see assertions.ts.
  payload_includes: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
}).strict();

const CommandExitCodeCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.COMMAND_EXIT_CODE),
  equals: z.number().int(),
}).strict();

const CommandOutputContainsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.COMMAND_OUTPUT_CONTAINS),
  contains: z.array(z.string()).min(1),
}).strict();

const CommandOutputNotContainsCriterionSchema = BaseCriterionSchema.extend({
  kind: z.literal(CriterionKind.COMMAND_OUTPUT_NOT_CONTAINS),
  not_contains: z.array(z.string()).min(1),
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
  path: z.string().optional(),
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
  // Path to a git-tracked file (relative to workspaceRoot) whose diff against its repo's
  // root commit is computed as evidence instead of evidence_path's raw final-state content.
  // Takes precedence over evidence_path when both are set. Makes "did anything change"
  // unambiguous — a raw final-state snapshot leaves the judge inferring that from prose
  // alone, and live testing showed it sometimes infers wrong.
  evidence_diff_path: z.string().min(1).optional(),
  // Path to a workspace-relative DIRECTORY that is the git repo whose ENTIRE branch diff (vs
  // its root commit) is the judge evidence — the complete set of applied code changes. For a
  // code-change task the judge reviews the diff, not a single file. Takes precedence over
  // evidence_diff_path and evidence_path. See assertions.ts:computeGitDiffEvidence.
  evidence_diff_dir: z.string().min(1).optional(),
  preset: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
  // Path to a file (relative to workspaceRoot, e.g. the original request fixture) whose
  // content is passed as buildEvaluationPrompt's context. Without it, a preset like
  // GOAL_ALIGNED_REVIEW asks the judge to score "goal_alignment"/"request_understanding"
  // against a stated objective the judge was never shown — it can only guess.
  context_path: z.string().min(1).optional(),
  // Step id whose test-run outcome (PASSED/FAILED + exit code + output) is passed to the judge
  // as additional context. A judge must run and grade EVEN when the tests failed — the failure
  // is the signal being evaluated, not a reason to skip. See assertions.ts.
  test_run_source: z.string().min(1).optional(),
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
  CommandOutputNotContainsCriterionSchema,
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
  /** Continuous criterion score 0-1. Absent ⇒ derive from status (PASSED=1, else 0). */
  score: z.number().min(0).max(1).optional(),
  /** Criterion class propagated from the criterion definition (Phase 143 Step 3) — lets
   *  the gated scorer gate without re-resolving step definitions. */
  class: CriterionClassSchema.optional(),
  /** Judge provenance — populated only by llm-judge. */
  judge: z.object({
    provider: z.string(),
    model: z.string(),
    reasoning: z.string().optional(),
  }).optional(),
}).strict();

export type ICriterionResult = z.infer<typeof CriterionResultSchema>;

export const ScenarioStepSchema = z.object({
  id: NON_EMPTY_STRING,
  type: ScenarioStepTypeSchema,
  name: NON_EMPTY_STRING.optional(),
  command: NON_EMPTY_STRING.optional(),
  args: z.array(z.string()).optional(),
  /** Working directory the step runs in (and file_pattern/file criteria resolve against).
   *  Omitted → workspace root. A relative path resolves against the workspace root. The token
   *  `$WORKTREE` resolves to the scenario's newest execution worktree — so scenarios never
   *  hardcode deep `.exa/worktrees/...` globs. */
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** Matrix-cell scoping: when present, this step only runs for cells whose `tool` is in
   *  this list — every other cell skips it entirely (removed before execution, not merely
   *  no-opped). For scenarios whose matrix mixes cell types needing different one-time
   *  setup (e.g. patch-blueprint-capability's cli_delegate capability patch, needed only by
   *  CLI-delegate cells, never by direct-API cells sharing the same steps array). Omitted →
   *  the step runs for every cell (and for matrix-less scenarios), unchanged. */
  cells: z.array(NON_EMPTY_STRING).min(1).optional(),
  timeout_sec: z.number().int().positive().optional(),
  // wait-for-file: an optional second glob polled alongside args[0]. If it matches before
  // the success glob does, the step fails immediately (surfacing the matched file's content
  // in stderr) instead of burning the rest of timeout_sec waiting for a file that a known
  // failure (e.g. a rejected plan) means will never appear.
  failure_glob: NON_EMPTY_STRING.optional(),
  // journal-assert: declarative activity-journal query (no raw SQL). Filter fields narrow the
  // rows considered; `project`/`sums` shape the emitted JSON; `expect_*` picks the assertion
  // contract (default: at least one matching row). `trace_scoped` scopes to the current
  // request's trace (first request.created above the scenario baseline).
  action_type: NON_EMPTY_STRING.optional(),
  action_types: z.array(NON_EMPTY_STRING).min(1).optional(),
  action_type_prefix: NON_EMPTY_STRING.optional(),
  trace_scoped: z.boolean().optional(),
  payload_equals: z.array(
    z.object({
      path: NON_EMPTY_STRING,
      value: z.union([z.string(), z.number(), z.boolean()]),
    }).strict(),
  ).optional(),
  payload_contains: z.array(NON_EMPTY_STRING).optional(),
  payload_not_contains: z.array(NON_EMPTY_STRING).optional(),
  latest_only: z.boolean().optional(),
  // project: column name -> value source. Sources: "action_type", "trace_id", "rowid", or a
  // payload JSON path prefixed "payload." (e.g. "payload.tool_name").
  project: z.record(z.string().min(1), z.string().min(1)).optional(),
  // sums: column name -> payload JSON path summed over matching rows (single aggregate row).
  sums: z.record(z.string().min(1), z.string().min(1)).optional(),
  expect_count: z.number().int().min(0).optional(),
  expect_sum: z.object({
    path: NON_EMPTY_STRING,
    gt: z.number(),
  }).strict().optional(),
  // expect_contains: every substring must appear in the LATEST matching row's payload.
  expect_contains: z.array(NON_EMPTY_STRING).min(1).optional(),
  // file-contains: wait until at least this many files match the step's glob(s) (args and/or
  // file_pattern) before evaluating its file/text criteria. Default 1.
  min_matches: z.number().int().min(1).optional(),
  // patch-blueprint: the identity whose sandboxed blueprint gets capabilities added.
  blueprint: z.string().min(1).optional(),
  // patch-blueprint: capabilities to add to the blueprint's capabilities array.
  add_capabilities: z.array(z.string().min(1)).optional(),
  // prepare-evidence: cwd-relative source file to copy to the evidence target.
  source: z.string().min(1).optional(),
  // prepare-evidence: workspace-relative target for the copied evidence (default llm-judge-input.txt).
  target: z.string().min(1).optional(),
  // write-file: workspace-relative path to write.
  path: z.string().min(1).optional(),
  // write-file: content to write (overwrites); with `append: true` it appends.
  content: z.string().optional(),
  // write-file: append to the file instead of overwriting.
  append: z.boolean().optional(),
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
  source_step_rowid_start: z.number().int().min(0).optional(),
  source_step_rowid_end: z.number().int().min(0).optional(),
  expected_sequence: z.array(ExpectedSequenceEntrySchema).optional(),
  order_matters: z.boolean().optional(),
  allow_extra_tools: z.boolean().optional(),
  partial_credit: z.boolean().optional(),
  step_pass_threshold: z.number().min(0).max(1).optional(),
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

  // A file/text criterion with no `path` relies on the step's file_pattern to resolve its target
  // at evaluation time (rewriteCriteriaWithTarget). Without a file_pattern the target is unknowable.
  const pathlessFileKinds = [
    CriterionKind.FILE_EXISTS,
    CriterionKind.FILE_NOT_EXISTS,
    CriterionKind.TEXT_CONTAINS,
    CriterionKind.TEXT_MATCHES,
  ];
  for (const criterion of [...(step.input_criteria ?? []), ...(step.output_criteria ?? [])]) {
    if (pathlessFileKinds.includes(criterion.kind) && !(criterion as { path?: string }).path && !step.file_pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${criterion.kind} criteria without a path require a step file_pattern`,
        path: [criterion.id],
      });
    }
  }
});

export type IScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioSchemaVersionSchema = z.string().regex(VERSION_PATTERN);

export type IScenarioExecutionMode = z.infer<typeof ScenarioExecutionModeSchema>;
