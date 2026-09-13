/**
 * @module MemoryTaskSchema
 * @path tests/scenario_framework/schema/memory_task_schema.ts
 * @description Zod schema for fixtures/memory/<task-id>/task.json files. Validates the
 * per-task memory-benchmark contract — ability tag, session writes to seed, and queries
 * with ground-truth relevant memory ids — that drives the Phase 148 memory-replay
 * scenarios. Mirrors task_schema.ts's shape for fixtures/swe_tasks.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/memory_corpus_lint.ts, tests/scenario_framework/scripts/run_memory_replay.ts, tests/scenario_framework/tests/unit/memory_corpus_lint_test.ts]
 */
import { z } from "zod";

/** The five LongMemEval-aligned memory-evaluation abilities this phase's corpus covers. */
export const MemoryAbilitySchema = z.enum([
  "information-extraction",
  "multi-session-reasoning",
  "temporal-reasoning",
  "knowledge-updates",
  "abstention",
]);

export type IMemoryAbility = z.infer<typeof MemoryAbilitySchema>;

/** One memory-content fixture to seed before a task's queries run. `id` becomes the
 * seeded `ILearning.id` (a query's `ground_truth_ids` references it), so it must be a
 * valid UUID — the same constraint `LearningSchema.id` (`packages/schemas/src/
 * memory_bank.ts`) enforces on every learning production writes. */
export const MemorySessionWriteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
});

export type IMemorySessionWrite = z.infer<typeof MemorySessionWriteSchema>;

/** A query issued against the seeded memory store. `ground_truth_ids` is empty only for
 * an `abstention`-ability task's query (no relevant memory should exist to retrieve);
 * otherwise each id must match a `session_writes[].id` UUID. */
export const MemoryQuerySchema = z.object({
  text: z.string().min(1),
  ground_truth_ids: z.array(z.string().uuid()),
  expected_answer: z.string().min(1).optional(),
});

export type IMemoryQuery = z.infer<typeof MemoryQuerySchema>;

/** Each task directory under fixtures/memory/<task-id>/ must contain a task.json
 * matching this schema. */
export const MemoryTaskJsonSchema = z.object({
  ability: MemoryAbilitySchema,
  session_writes: z.array(MemorySessionWriteSchema).min(1),
  queries: z.array(MemoryQuerySchema).min(1),
});

export type IMemoryTaskJson = z.infer<typeof MemoryTaskJsonSchema>;
