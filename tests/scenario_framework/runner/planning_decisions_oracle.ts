/**
 * @module PlanningDecisionsOracle
 * @path tests/scenario_framework/runner/planning_decisions_oracle.ts
 * @description Checks decision records and migration graphs against independent case contracts.
 * @architectural-layer Test
 * @dependencies [zod]
 * @related-files [tests/scenario_framework/tests/unit/planning_decisions_oracle_test.ts]
 */
import { z } from "zod";
import { equal } from "@std/assert";

const JsonSchema = z.json();
const CriterionSchema = z.object({ id: z.string(), status: z.enum(["RESOLVED", "PENDING"]), outcome: JsonSchema });
const DecisionSchema = z.object({
  id: z.string(),
  choice: z.string(),
  source: z.string(),
  acceptance_ids: z.array(z.string()).min(1),
  cost_row: z.string().min(1),
});
const StageSchema = z.object({
  id: z.string(),
  depends_on: z.array(z.string()),
  api: z.array(z.string()),
  callers: z.array(z.object({ consumer: z.string(), method: z.string() })),
  tests: z.array(z.string()).min(1),
  rollback: z.object({
    requires_api: z.array(z.string()).min(1),
    restore_callers: z.array(z.string()),
    restore_compatible_api_first: z.boolean().optional(),
  }),
}).catchall(JsonSchema);
const RecordSchema = z.object({
  case_id: z.string(),
  status: z.enum(["RESOLVED", "PENDING USER DECISION"]),
  questions: z.array(z.object({ id: z.string(), topic: z.string() })),
  decisions: z.array(DecisionSchema),
  acceptance: z.array(CriterionSchema).min(1),
  stages: z.array(StageSchema),
  terms: z.record(z.string(), z.string()),
  adr_proposals: z.array(z.object({
    decision: z.string(),
    alternatives: z.array(z.string()),
    rationale: z.string(),
    consequences: z.array(z.string()),
    hard_to_reverse: z.string(),
  })),
  created_files: z.array(z.string()),
  migration_reason: z.string().optional(),
});
type PlanRecord = z.infer<typeof RecordSchema>;
type Stage = z.infer<typeof StageSchema>;
type Json = z.infer<typeof JsonSchema>;
const CASES = ["p234-s6-c1", "p234-s6-c2", "p234-s6-c3", "p234-s6-c4", "p234-s6-c5"];

function matches(value: Json, expected: Json): boolean {
  return equal(value, expected);
}

function outcome(record: PlanRecord, id: string): Json {
  return record.acceptance.find((entry) => entry.id === id)?.outcome ?? null;
}

function hasBothCallers(stage: Stage): boolean {
  return stage.callers.length === 2 &&
    ["CLI", "daemon reports"].every((name) =>
      stage.callers.some((caller) => caller.consumer === name && caller.method === "countByStatus")
    );
}

function reachableFeature(record: PlanRecord): boolean {
  const first = record.stages[0];
  return first !== undefined && first.entrypoint === "exactl request count --status pending" &&
    first.registered === true && first.store === "RequestStore" &&
    first.callers.some((caller) => caller.consumer === "CLI" && caller.method === "countByStatus") &&
    ["AC-empty", "AC-filter"].every((id) => first.tests.includes(id)) &&
    matches(first.new_services ?? null, []) && matches(first.new_schemas ?? null, []) &&
    matches(outcome(record, "AC-empty"), { pending: 0, completed: 0, stdout: "0" }) &&
    matches(outcome(record, "AC-filter"), { pending: 2, completed: 1, stdout: "2" });
}

function compatibleMigration(record: PlanRecord): boolean {
  if (!/cannot deploy atomically/i.test(record.migration_reason ?? "")) return false;
  const ids = ["expand", "cli", "reports", "integration", "contract"];
  if (!matches(record.stages.map((stage) => stage.id), ids)) return false;
  const [expand, cli, reports, integration, contract] = record.stages;
  const edges = [[], ["expand"], ["expand"], ["cli", "reports"], ["integration"]];
  if (!record.stages.every((stage, index) => matches(stage.depends_on.toSorted(), edges[index].toSorted()))) {
    return false;
  }
  if (!record.stages.slice(0, -1).every((stage) => stage.api.includes("countPending"))) return false;
  if (!record.stages.every((stage) => stage.api.includes("countByStatus"))) return false;
  if (!cli.callers.some((caller) => caller.consumer === "CLI" && caller.method === "countByStatus")) return false;
  if (!reports.callers.some((caller) => caller.consumer === "daemon reports" && caller.method === "countByStatus")) {
    return false;
  }
  return expand.tests.includes("pending-equivalence") && cli.tests.includes("cli-pending-count") &&
    reports.tests.includes("reports-pending-count") && hasBothCallers(integration) && hasBothCallers(contract) &&
    integration.tests.includes("cli-and-reports-production") &&
    contract.tests.includes("zero-countPending-consumers") && matches(contract.old_consumers ?? null, []) &&
    !contract.api.includes("countPending") &&
    record.stages.every((stage) => stage.rollback.requires_api.includes("countPending")) &&
    cli.rollback.restore_callers.includes("CLI") && reports.rollback.restore_callers.includes("daemon reports") &&
    contract.rollback.restore_compatible_api_first === true &&
    matches(outcome(record, "AC-equivalence"), { countPending: 2, countByStatus_pending: 2 });
}

function settledChoice(record: PlanRecord): boolean {
  const choice = record.decisions.find((entry) => entry.id === "U-17");
  const pending = record.acceptance.find((entry) => entry.id === "AC-destination");
  return record.status === "PENDING USER DECISION" && record.questions.length === 1 &&
    record.questions[0].id === "Q-destination" && /destination directory/i.test(record.questions[0].topic) &&
    choice?.source === "U-17" && choice.choice === "local JSONL" && choice.acceptance_ids.includes("AC-export") &&
    matches(outcome(record, "AC-export"), { format: "JSONL", hosting: "local" }) &&
    pending?.status === "PENDING" && matches(pending.outcome, { depends_on: "Q-destination" }) &&
    record.stages.length === 0;
}

function establishedMeaning(record: PlanRecord): boolean {
  return /configured persona.*agent_role/i.test(record.terms["Agent Role"] ?? "") &&
    record.decisions.some((entry) =>
      /glossary/i.test(entry.source) && /reviewer role blueprint/i.test(entry.choice) &&
      entry.acceptance_ids.includes("AC-role")
    ) && matches(outcome(record, "AC-role"), { request: "req-42", agent_role: "reviewer" });
}

function selectiveAdr(record: PlanRecord): boolean {
  const proposal = record.adr_proposals[0];
  return record.adr_proposals.length === 1 && proposal.decision === "D-ledger" &&
    ["mutable rows", "immutable ledger"].every((name) => proposal.alternatives.includes(name)) &&
    /signed bytes/i.test(proposal.rationale) && /independent verification/i.test(proposal.rationale) &&
    /read.model/i.test(proposal.consequences.join(" ")) && /migration/i.test(proposal.consequences.join(" ")) &&
    /cannot.*reconstruct/i.test(proposal.hard_to_reverse) &&
    matches(outcome(record, "AC-label"), { label: "Runs" }) &&
    matches(outcome(record, "AC-correction"), { original_signed_rows: "preserved", corrections: "new entries" });
}

function parseRecord(raw: string): PlanRecord | null {
  const blocks = [...raw.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length > 1) return null;
  try {
    const parsed = RecordSchema.safeParse(JSON.parse(blocks[0]?.[1] ?? raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Evaluates plan outcomes without inspecting the skill's wording. */
export function evaluatePlanning(caseId: string, raw: string): { ok: boolean; reasons: string[] } {
  if (!CASES.includes(caseId)) throw new Error(`Unknown planning case: ${caseId}`);
  const record = parseRecord(raw);
  if (!record || record.case_id !== caseId) return { ok: false, reasons: ["Missing or mismatched planning record"] };
  const groups = [record.stages, record.decisions, record.acceptance, record.questions];
  if (groups.some((entries) => new Set(entries.map((entry) => entry.id)).size !== entries.length)) {
    return { ok: false, reasons: ["Duplicate record identities"] };
  }
  const linked = record.decisions.every((entry) =>
    entry.acceptance_ids.every((id) => record.acceptance.some((criterion) => criterion.id === id))
  );
  const resolved = caseId === "p234-s6-c3" || (record.status === "RESOLVED" && record.questions.length === 0 &&
    record.acceptance.every((criterion) => criterion.status === "RESOLVED"));
  const checks = [reachableFeature, compatibleMigration, settledChoice, establishedMeaning, selectiveAdr];
  const ok = linked && resolved && record.created_files.length === 0 &&
    (caseId === "p234-s6-c5" || record.adr_proposals.length === 0) && checks[CASES.indexOf(caseId)](record);
  return { ok, reasons: ok ? [] : [`Plan contradicts the independent ${caseId} contract`] };
}
