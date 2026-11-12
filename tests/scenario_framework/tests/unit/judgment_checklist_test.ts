/**
 * @module JudgmentChecklistTest
 * @path tests/scenario_framework/tests/unit/judgment_checklist_test.ts
 * @description Covers the deterministic composite, the critical gate, unsure policies, escalation and the frozen fixtures.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/runner/judgment_checklist.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  ChecklistAnswerError,
  ChecklistSchema,
  type IChecklistAnswer,
  type IJudgmentChecklist,
  needsEscalation,
  scoreChecklist,
} from "../../runner/judgment_checklist.ts";

function checklist(unsurePolicy: "exclude" | "zero"): IJudgmentChecklist {
  return {
    id: "test-checklist",
    artifactType: "plan",
    version: "1.0.0",
    unsurePolicy,
    questions: [
      {
        id: "critical",
        question: "Is the critical requirement present?",
        critical: true,
        derivation: false,
        weight: 0.5,
        criteria: { yes: "Present.", no: "Absent." },
      },
      {
        id: "ordinary",
        question: "Is the ordinary requirement present?",
        critical: false,
        derivation: false,
        weight: 0.3,
        criteria: { yes: "Present.", no: "Absent." },
      },
      {
        id: "derived",
        question: "Does the derivation hold?",
        critical: false,
        derivation: true,
        weight: 0.2,
        criteria: { yes: "It holds.", no: "It does not hold." },
      },
    ],
  };
}

function answers(overrides: Record<string, IChecklistAnswer["answer"]> = {}): IChecklistAnswer[] {
  return ["critical", "ordinary", "derived"].map((questionId) => ({
    questionId,
    answer: overrides[questionId] ?? "yes",
    evidence: `Evidence for ${questionId}`,
  }));
}

Deno.test("all yes answers produce a perfect composite", () => {
  const result = scoreChecklist(checklist("exclude"), answers());
  assertEquals(result.status, "scored");
  assertEquals(result.score, 1);
  assertEquals(result.gatePassed, true);
});

Deno.test("a critical no scores zero and fails the gate", () => {
  const result = scoreChecklist(checklist("exclude"), answers({ critical: "no" }));
  assertEquals(result.status, "scored");
  assertEquals(result.score, 0);
  assertEquals(result.gatePassed, false);
});

Deno.test("a weight sum outside the tolerance is rejected", () => {
  const raw = { ...checklist("exclude"), questions: checklist("exclude").questions.map((q) => ({ ...q })) };
  raw.questions[0].weight = 0.6;
  assertEquals(ChecklistSchema.safeParse(raw).success, false);
});

Deno.test("duplicate question ids are rejected", () => {
  const raw = { ...checklist("exclude"), questions: checklist("exclude").questions.map((q) => ({ ...q })) };
  raw.questions[1].id = "critical";
  assertEquals(ChecklistSchema.safeParse(raw).success, false);
});

Deno.test("the exclude policy renormalizes over included weights", () => {
  const result = scoreChecklist(checklist("exclude"), answers({ ordinary: "unsure" }));
  assertEquals(result.status, "scored");
  assertEquals(result.score, 1);
  assertEquals(result.excludedQuestionIds, ["ordinary"]);
  assertEquals(result.unsurePolicy, "exclude");
});

Deno.test("the zero policy scores unsure as zero and records the policy", () => {
  const result = scoreChecklist(checklist("zero"), answers({ ordinary: "unsure" }));
  assertEquals(result.status, "scored");
  assertEquals(result.score, 0.7);
  assertEquals(result.excludedQuestionIds, []);
  assertEquals(result.unsurePolicy, "zero");
});

Deno.test("a critical unsure fails the gate provisionally and escalates", () => {
  const result = scoreChecklist(checklist("zero"), answers({ critical: "unsure" }));
  assertEquals(result.status, "pending");
  assertEquals(result.gatePassed, false);
  assertEquals(result.escalated, true);
  assertEquals(result.score, undefined);
});

Deno.test("an exclude policy with no included weight is pending", () => {
  const singleQuestion: IJudgmentChecklist = {
    ...checklist("exclude"),
    questions: [{ ...checklist("exclude").questions[1], weight: 1 }],
  };
  const result = scoreChecklist(singleQuestion, [
    { questionId: "ordinary", answer: "unsure", evidence: "No evidence" },
  ]);
  assertEquals(result.status, "pending");
  assertEquals(result.pendingReason, "No weight is included under the exclude policy");
});

Deno.test("escalation returns unsure and derivation-flagged ids only", () => {
  assertEquals(needsEscalation(answers({ critical: "unsure" }), checklist("exclude")), [
    "critical",
    "derived",
  ]);
  assertEquals(needsEscalation(answers(), checklist("exclude")), ["derived"]);
  const noDerivation = checklist("exclude");
  noDerivation.questions[2].derivation = false;
  assertEquals(needsEscalation(answers(), noDerivation), []);
});

Deno.test("missing, duplicate and unknown answers are rejected", () => {
  assertThrows(
    () => scoreChecklist(checklist("exclude"), answers().slice(0, 2)),
    ChecklistAnswerError,
    "Missing answer",
  );
  assertThrows(
    () => scoreChecklist(checklist("exclude"), [...answers(), answers()[0]]),
    ChecklistAnswerError,
    "Duplicate answer",
  );
  assertThrows(
    () =>
      scoreChecklist(checklist("exclude"), [
        ...answers(),
        { questionId: "unknown", answer: "yes", evidence: "Unknown" },
      ]),
    ChecklistAnswerError,
    "Unknown question id",
  );
});

Deno.test("both frozen checklists validate against the schema", async () => {
  for (const name of ["fix-bug-plan", "test-development-plan"]) {
    const url = new URL(`../../fixtures/skill_eval/phase243/checklists/${name}.json`, import.meta.url);
    const parsed = ChecklistSchema.safeParse(JSON.parse(await Deno.readTextFile(url)));
    assertEquals(parsed.success, true);
  }
});
