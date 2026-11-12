/**
 * @module JudgmentChecklist
 * @path tests/scenario_framework/runner/judgment_checklist.ts
 * @description Checklist schema, deterministic composite scoring and the escalation predicate.
 * @architectural-layer Test
 * @dependencies [zod, ./judgment_thresholds.ts]
 * @related-files [tests/scenario_framework/tests/unit/judgment_checklist_test.ts]
 */

import { z } from "zod";
import { WEIGHT_SUM_TOLERANCE } from "./judgment_thresholds.ts";

/** The deterministic part of the composite result. Identity fields are added by the bridge. */
export interface ICompositeScore {
  status: "scored" | "pending";
  pendingReason?: string;
  score?: number;
  gatePassed: boolean;
  unsurePolicy: IUnsurePolicy;
  escalated: boolean;
  excludedQuestionIds: string[];
  answers: IChecklistAnswer[];
}

/** One frozen checklist question. */
export const ChecklistQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  critical: z.boolean(),
  /** Derivation-heavy: always routed to the escalation model. Frozen with the checklist. */
  derivation: z.boolean(),
  weight: z.number().positive(),
  criteria: z.object({
    yes: z.string().min(1),
    no: z.string().min(1),
  }),
});

/** How an `unsure` answer affects the included weight. */
export const UnsurePolicySchema = z.enum(["exclude", "zero"]);

/** A frozen checklist. Weights sum to 1 within the tolerance. */
export const ChecklistSchema = z
  .object({
    id: z.string().min(1),
    artifactType: z.string().min(1),
    version: z.string().min(1),
    unsurePolicy: UnsurePolicySchema,
    questions: z.array(ChecklistQuestionSchema).min(1),
  })
  .superRefine((checklist, ctx) => {
    const ids = new Set<string>();
    checklist.questions.forEach((question, index) => {
      if (ids.has(question.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate question id: ${question.id}`,
          path: ["questions", index, "id"],
        });
      }
      ids.add(question.id);
    });
    const sum = checklist.questions.reduce((total, question) => total + question.weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Weights must sum to 1 within ${WEIGHT_SUM_TOLERANCE}; got ${sum}`,
        path: ["questions"],
      });
    }
  });

/** One model answer. */
export const ChecklistAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.enum(["yes", "no", "unsure"]),
  evidence: z.string().min(1).max(240),
});

/** The only object the model emits. */
export const ScorerAnswersSchema = z.object({
  answers: z.array(ChecklistAnswerSchema),
});

/** A checklist question. */
export type IChecklistQuestion = z.infer<typeof ChecklistQuestionSchema>;
/** A frozen checklist. */
export type IJudgmentChecklist = z.infer<typeof ChecklistSchema>;
/** One answer. */
export type IChecklistAnswer = z.infer<typeof ChecklistAnswerSchema>;
/** The unsure policy. */
export type IUnsurePolicy = z.infer<typeof UnsurePolicySchema>;

/** A malformed answer set. The adapter retries once, then reports pending. */
export class ChecklistAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChecklistAnswerError";
  }
}

/** Indexes answers and rejects missing, duplicate or unknown question ids. */
function indexAnswers(
  checklist: IJudgmentChecklist,
  answers: readonly IChecklistAnswer[],
): Map<string, IChecklistAnswer> {
  const questionIds = new Set(checklist.questions.map((question) => question.id));
  const indexed = new Map<string, IChecklistAnswer>();
  for (const answer of answers) {
    if (!questionIds.has(answer.questionId)) {
      throw new ChecklistAnswerError(`Unknown question id: ${answer.questionId}`);
    }
    if (indexed.has(answer.questionId)) {
      throw new ChecklistAnswerError(`Duplicate answer for question: ${answer.questionId}`);
    }
    indexed.set(answer.questionId, answer);
  }
  for (const questionId of questionIds) {
    if (!indexed.has(questionId)) {
      throw new ChecklistAnswerError(`Missing answer for question: ${questionId}`);
    }
  }
  return indexed;
}

/** Scores one checklist without any provider call. */
export function scoreChecklist(
  checklist: IJudgmentChecklist,
  answers: readonly IChecklistAnswer[],
): ICompositeScore {
  const indexed = indexAnswers(checklist, answers);
  const copiedAnswers = [...answers];
  const criticalUnsure = checklist.questions.filter(
    (question) => question.critical && indexed.get(question.id)?.answer === "unsure",
  );
  const gatePassed = checklist.questions.every(
    (question) => !question.critical || indexed.get(question.id)?.answer === "yes",
  );
  const escalated = needsEscalation(copiedAnswers, checklist).length > 0;

  if (criticalUnsure.length > 0) {
    return {
      status: "pending",
      pendingReason: `Critical question is unsure and needs escalation: ${criticalUnsure.map((q) => q.id).join(", ")}`,
      gatePassed: false,
      unsurePolicy: checklist.unsurePolicy,
      escalated: true,
      excludedQuestionIds: [],
      answers: copiedAnswers,
    };
  }

  const included = checklist.questions.filter(
    (question) => checklist.unsurePolicy === "zero" || indexed.get(question.id)?.answer !== "unsure",
  );
  const excludedQuestionIds = checklist.unsurePolicy === "exclude"
    ? checklist.questions.filter((question) => indexed.get(question.id)?.answer === "unsure").map((q) => q.id)
    : [];
  const denominator = included.reduce((total, question) => total + question.weight, 0);
  if (denominator === 0) {
    return {
      status: "pending",
      pendingReason: "No weight is included under the exclude policy",
      gatePassed,
      unsurePolicy: checklist.unsurePolicy,
      escalated,
      excludedQuestionIds,
      answers: copiedAnswers,
    };
  }
  const numerator = included.reduce((total, question) => {
    const answer = indexed.get(question.id)?.answer;
    return total + (answer === "yes" ? question.weight : 0);
  }, 0);
  return {
    status: "scored",
    score: gatePassed ? numerator / denominator : 0,
    gatePassed,
    unsurePolicy: checklist.unsurePolicy,
    escalated,
    excludedQuestionIds,
    answers: copiedAnswers,
  };
}

/** Returns the question ids whose answer is unsure or whose question is derivation-heavy. */
export function needsEscalation(
  answers: readonly IChecklistAnswer[],
  checklist: IJudgmentChecklist,
): string[] {
  const unsure = new Set(
    answers.filter((answer) => answer.answer === "unsure").map((answer) => answer.questionId),
  );
  return checklist.questions
    .filter((question) => question.derivation || unsure.has(question.id))
    .map((question) => question.id);
}
