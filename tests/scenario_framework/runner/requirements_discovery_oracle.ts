/**
 * @module RequirementsDiscoveryOracle
 * @path tests/scenario_framework/runner/requirements_discovery_oracle.ts
 * @description Checks case-specific requirements decisions without treating instruction vocabulary as evidence.
 * @architectural-layer Test
 * @dependencies [zod]
 * @related-files [tests/scenario_framework/tests/unit/requirements_discovery_oracle_test.ts]
 */
import { z } from "zod";
import type { Opt, Reason } from "@exaix/core/types";

const JsonSchema = z.json();
type Json = z.infer<typeof JsonSchema>;
const EntrySchema = z.object({ id: z.string().min(1) }).catchall(JsonSchema);
const CriterionSchema = EntrySchema.extend({ status: z.enum(["RESOLVED", "PENDING", "STALE"]) });
const ArtifactSchema = z.object({
  case_id: z.string(),
  status: z.enum(["RESOLVED", "PENDING USER DECISION"]),
  questions: z.array(EntrySchema),
  decisions: z.array(EntrySchema),
  assumptions: z.array(EntrySchema),
  acceptance: z.array(CriterionSchema).min(1),
  terms: JsonSchema,
  adr_proposals: z.array(EntrySchema),
}).catchall(JsonSchema);
type Artifact = z.infer<typeof ArtifactSchema>;
type Entry = z.infer<typeof EntrySchema>;
interface IVerdict {
  ok: boolean;
  reasons: string[];
}
const CASES = [
  "p234-s5-c1",
  "p234-s5-c2",
  "p234-s5-c3",
  "p234-s5-c4",
  "p234-s5-c5",
  "p234-v5-c1",
  "p234-v5-c2",
  "p234-v5-c3",
];
const COUNT_EXAMPLES = [[0, "0 items"], [1, "1 item"], [2, "2 items"]] as const;

function text(value?: Opt<Json, Reason.OptionalInput>): string {
  return JSON.stringify(value ?? null).toLowerCase();
}

function named(entries: Entry[], id: string): Entry | undefined {
  return entries.find((entry) => entry.id === id);
}

function has(value: Json, patterns: RegExp[]): boolean {
  return patterns.every((pattern) => pattern.test(text(value)));
}

function complete(record: Artifact): boolean {
  return record.status === "RESOLVED" && record.questions.length === 0 &&
    record.acceptance.every((criterion) => criterion.status === "RESOLVED");
}

function countOutcome(record: Artifact): boolean {
  const decisionsAgree = record.decisions.every((entry) =>
    typeof entry.decision === "string" && /\b0\b/.test(entry.decision) && /0 items/i.test(entry.decision) &&
    !/\bnot\s+(?:return\s+)?["']?0 items/i.test(entry.decision)
  );
  return complete(record) && decisionsAgree && record.acceptance.length === COUNT_EXAMPLES.length &&
    COUNT_EXAMPLES.every(([input, expected]) =>
      record.acceptance.some((criterion) => criterion.input === input && criterion.expected === expected)
    );
}

function pendingRetention(record: Artifact): boolean {
  const question = record.questions[0];
  const deletion = record.acceptance.find((entry) =>
    entry.status === "PENDING" && has(entry, [/completed/, /delet/]) &&
    question !== undefined && text(entry).includes(question.id.toLowerCase())
  );
  const active = record.acceptance.find((entry) =>
    entry.status === "RESOLVED" && has(entry, [/active/, /never delet|do not delet|remains? present/])
  );
  const inventedChoice = /\b\d+\s*(?:days?|hours?|weeks?)\b|created_at|completed_at/.test(text(record.decisions));
  return record.status === "PENDING USER DECISION" && record.questions.length === 1 && !inventedChoice &&
    has(record.questions, [/retention/, /period/, /clock|basis|timestamp/]) && deletion !== undefined &&
    active !== undefined;
}

function answeredRetention(record: Artifact, prior: string): boolean {
  const previous = parseArtifact(prior);
  if (!previous || previous.case_id !== record.case_id || !pendingRetention(previous)) return false;
  const identified = text(record.supersedes).includes(record.case_id) ||
    (text(record.questions).includes(record.case_id) && has(record.questions, [/earlier|prior/]));
  const resolved = record.status === "RESOLVED" &&
    record.questions.every((question) => question.status === "RESOLVED") &&
    record.acceptance.every((criterion) => criterion.status === "RESOLVED");
  const active = record.acceptance.some((criterion) =>
    has(criterion, [/active/, /never delet|do not delet|not delet|remains? present/])
  );
  const directBoundary = record.acceptance.some((criterion) =>
    has(criterion, [/completed_at\s*(?:<=|at or before)/, /\b45\b/])
  );
  const splitBoundary = record.acceptance.some((criterion) => has(criterion, [/completed_at/, /equal/, /\b45\b/])) &&
    record.acceptance.some((criterion) => has(criterion, [/completed_at/, /earlier than/, /\b45\b/]));
  return resolved && identified && has(record.decisions, [/\b45\b/, /completed_at/]) &&
    !has(record.decisions, [/\b30\b/]) && !text(record.acceptance).includes("created_at") && active &&
    (directBoundary || splitBoundary);
}

function changedPrerequisite(record: Artifact): boolean {
  const assumption = named(record.assumptions, "A-local-delete");
  const purge = named(record.acceptance, "AC-local-purge");
  const expiry = record.acceptance.find((entry) =>
    entry.status === "PENDING" && has(entry, [/logical expiry|retention/])
  );
  const storage = named(record.decisions, "D-storage");
  return record.status === "PENDING USER DECISION" && storage !== undefined &&
    has(storage, [/external/, /immutable/, /adr-007/]) &&
    (assumption?.status === "INVALIDATED" || assumption?.status === "STALE") &&
    text(assumption).includes("d-storage") && purge?.status === "STALE" && text(purge).includes("d-storage") &&
    expiry?.status === "PENDING" && has(record.questions, [/logical expiry/, /physical deletion/]) &&
    record.adr_proposals.length === 0;
}

function roleSelection(record: Artifact): boolean {
  return complete(record) && has(record.terms, [/agent role/, /req-42/]) &&
    record.acceptance.some((criterion) =>
      has(criterion, [/req-42/, /agent_role/, /reviewer/]) && !/run-17|run-29/.test(text(criterion))
    );
}

function paginationOutcome(record: Artifact): boolean {
  return complete(record) &&
    record.decisions.some((entry) => has(entry, [/\b25\b/, /page|items/])) &&
    record.acceptance.some((criterion) => criterion.input === 1 && criterion.expected === "1 item") &&
    record.acceptance.some((criterion) => criterion.input === 26 && criterion.expected === "2 pages");
}

function pendingExport(record: Artifact): boolean {
  const question = record.questions[0];
  const pending = record.acceptance.find((entry) =>
    entry.status === "PENDING" && question !== undefined && text(entry).includes(question.id.toLowerCase())
  );
  const header = record.acceptance.find((entry) => entry.status === "RESOLVED" && has(entry, [/header/]));
  const invented = /\bcsv\b|\bjson\b|\bparquet\b|\bxlsx\b/.test(text(record.decisions));
  return record.status === "PENDING USER DECISION" && record.questions.length === 1 &&
    has(record.questions, [/format/, /export|report/]) && !invented &&
    pending !== undefined && header !== undefined;
}

function staleCache(record: Artifact): boolean {
  const assumption = named(record.assumptions, "A-cache");
  const criterion = named(record.acceptance, "AC-cache");
  const storage = named(record.decisions, "D-storage");
  return record.status === "PENDING USER DECISION" && storage !== undefined &&
    has(storage, [/immutable/, /event log|append-only/]) &&
    (assumption?.status === "INVALIDATED" || assumption?.status === "STALE") &&
    text(assumption).includes("d-storage") &&
    criterion?.status === "STALE" && text(criterion).includes("d-storage") &&
    has(record.questions, [/refresh/, /cache/]) && record.adr_proposals.length === 0;
}

function selectiveAdr(record: Artifact): boolean {
  const label = named(record.decisions, "D-label");
  const storage = named(record.decisions, "D-storage");
  const proposal = record.adr_proposals[0];
  return complete(record) && label !== undefined && has(label, [/runs/, /no data or identifier migration/]) &&
    storage !== undefined && has(storage, [/immutable/, /ledger/]) && record.adr_proposals.length === 1 &&
    proposal.decision === "D-storage" &&
    has(proposal.alternatives ?? null, [/embedded transactional database/, /immutable.*ledger/]) &&
    has(proposal.rationale ?? null, [/independent/, /reconstruct/, /mutable database/, /r-audit-independent/]) &&
    has(proposal.costs ?? null, [/migration/, /read.model/]) && proposal.created !== true;
}

/** Reads the single requirements record, either directly or in one JSON fence. */
function parseArtifact(raw: string): Artifact | null {
  const blocks = [...raw.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length > 1) return null;
  try {
    const parsed = ArtifactSchema.safeParse(JSON.parse(blocks[0]?.[1] ?? raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Scores a case record and, for a later answer, its independently submitted predecessor. */
export function evaluateRequirements(
  caseId: string,
  raw: string,
  prior?: Opt<string, Reason.OptionalInput>,
): IVerdict {
  if (!CASES.includes(caseId)) throw new Error(`Unknown requirements case: ${caseId}`);
  const record = parseArtifact(raw);
  if (!record || record.case_id !== caseId) {
    return { ok: false, reasons: ["Missing, malformed or misidentified record"] };
  }
  if (record.automatic_resume === true || /(?:flow|skill) automatically resumes/.test(text(record))) {
    return { ok: false, reasons: ["Claims automatic flow resumption"] };
  }
  const checks = [record.questions, record.decisions, record.assumptions, record.acceptance, record.adr_proposals];
  if (checks.some((entries) => new Set(entries.map((entry) => entry.id)).size !== entries.length)) {
    return { ok: false, reasons: ["Contradictory or duplicate record identities"] };
  }
  let ok: boolean;
  switch (caseId) {
    case "p234-s5-c1":
      ok = countOutcome(record);
      break;
    case "p234-s5-c2":
      ok = prior === undefined ? pendingRetention(record) : answeredRetention(record, prior);
      break;
    case "p234-s5-c3":
      ok = changedPrerequisite(record);
      break;
    case "p234-s5-c4":
      ok = roleSelection(record);
      break;
    case "p234-s5-c5":
      ok = selectiveAdr(record);
      break;
    case "p234-v5-c1":
      ok = paginationOutcome(record);
      break;
    case "p234-v5-c2":
      ok = pendingExport(record);
      break;
    case "p234-v5-c3":
      ok = staleCache(record);
      break;
    default:
      throw new Error(`Unknown requirements case: ${caseId}`);
  }
  return { ok, reasons: ok ? [] : [`Requirements contradict the independent ${caseId} fixture`] };
}
