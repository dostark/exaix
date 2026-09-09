/**
 * @module TaskSchema
 * @path tests/scenario_framework/schema/task_schema.ts
 * @description Zod schema for swe_tasks task.json files. Validates the
 *   per-task metadata that drives the dogfood-loop template, controls
 *   harness, and reporting. Phase 141 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/tests/unit/task_contract_schema_test.ts]
 */
import { z } from "zod";

/** Provenance for a task ingested from an external public benchmark; absent for
 * internal swe_tasks harvested from Exaix's own git history. */
export const TaskSourceSchema = z.object({
  /** Which external benchmark this task was ingested from. */
  benchmark: z.enum(["terminal-bench", "swe-bench"]),
  /** Pinned upstream release identifier (commit SHA or version tag). */
  version: z.string().min(1),
  /** The task's identifier within the upstream benchmark. */
  task_id: z.string().min(1),
});

export type ITaskSource = z.infer<typeof TaskSourceSchema>;

/** Catalogued adversarial-pack injection vectors. */
export const AttackVectorSchema = z.enum([
  "portal-readme",
  "code-comment",
  "tool-output",
  "filename",
  "approval-social",
]);

export type IAttackVector = z.infer<typeof AttackVectorSchema>;

/** Adversarial-pack attack metadata for an attacked twin task. Absent on clean twins and on
 * every non-adversarial task. `twin_of` names the sibling clean task directory (same fixtures
 * root) this task is paired with for the AgentDojo triple. */
export const AttackBlockSchema = z.object({
  /** Injection vector, from the catalogue in fixtures/adversarial/VECTORS.md. */
  vector: AttackVectorSchema,
  /** Human-readable description of the deterministic predicate checked post-run. */
  objective_predicate: z.string().min(1),
  /** Task id (directory name) of this task's clean twin. */
  twin_of: z.string().min(1),
});

export type IAttackBlock = z.infer<typeof AttackBlockSchema>;

/** Each task directory under fixtures/swe_tasks/<task-id>/ must contain a
 * task.json matching this schema. */
export const TaskJsonSchema = z.object({
  /** Full git SHA of the base ref (parent commit for harvested tasks). */
  base_ref: z.string().regex(/^[a-f0-9]{40}$/, "base_ref must be a full 40-char SHA"),
  /** Shell command that runs the scoped tests for this task. */
  scoped_test_cmd: z.string().min(1),
  /** Test file paths expected to fail at base_ref (used by null control). */
  expected_fail_tests: z.array(z.string()).optional(),
  /** Task family tag, e.g. "task:bug-fix". */
  family: z.string().min(1),
  /** Difficulty rating: S (small) or M (medium). */
  difficulty: z.enum(["S", "M"]),
  /** Minimum reasonable ReAct iterations for the task (default 2). Used by turn-efficiency penalty. */
  min_turns: z.number().int().min(1).max(100).optional().default(2),
  /** Name of the fixture portal directory (relative to fixtures/portals/). Defaults to "todo_app". */
  portal: z.string().min(1).optional().default("todo_app"),
  /** Provenance for externally-sourced tasks. Absent for internal swe_tasks. */
  source: TaskSourceSchema.optional(),
  /** Human-readable task title. */
  title: z.string().optional(),
  /** Adversarial-pack attack metadata; absent on clean twins and non-adversarial tasks. */
  attack: AttackBlockSchema.optional(),
});

export type ITaskJson = z.infer<typeof TaskJsonSchema>;
