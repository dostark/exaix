/**
 * @module SkillDeliveryObservation
 * @path tests/scenario_framework/runner/skill_delivery_observation.ts
 * @description Checks request-bound usage against the stored skill snapshot and a retained prompt.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_evaluation_evidence.ts]
 */
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { stripExamplesSection } from "@exaix/core/func";
import type { Opt, Reason } from "@exaix/core/types";
import { computeRevisionId, computeSkillContentSha256 } from "@exaix/core/skills";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { z } from "zod";
import type { IEvidenceResult } from "./skill_evaluation_evidence.ts";
import approvedSkills from "../fixtures/skill_eval/phase234/approved_skill_revisions.json" with { type: "json" };

/** The approved revision an isolated case must deliver. */
export interface IExpectedSubmission {
  requestId: string;
  skill: string;
  root: string;
  revision: string;
  sha256: string;
  instructions: string;
}

/** One request-bound provider submission recorded in the journal. */
export interface IRecordedSubmission {
  requestId: string;
  skill: string;
  root: string;
  revision: string;
  sha256: string;
  callId: string;
  submissionKind: string;
  matchSource: string;
}

/** A retained provider prompt that is claimed for one submission. */
export interface ISubmissionCapture {
  requestId: string;
  callId: string;
  prompt: string;
}

/** The journal row, retained prompt, and verdict that bind them to the request. */
export interface ISkillSubmissionBinding {
  expected?: IExpectedSubmission;
  usage?: IRecordedSubmission;
  capture?: ISubmissionCapture;
  result: IEvidenceResult;
}

const ReferencesSchema = z.array(z.object({ path: z.string(), content: z.string() }).strict());

const CaptureSchema = z.object({
  skill: z.string().min(1),
  root: z.string().min(1),
  revision: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prompt: z.string().min(1),
  requestId: z.string().regex(/^request-[a-f0-9]{8}$/).optional(),
  callId: z.string().min(1).optional(),
}).strict();
const CASE_ID = /^p234-s([1-6])-c[1-5]$/;
const REQUEST_ID = /^request-[a-f0-9]{8}$/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** A retained prompt, with optional call binding extracted from the provider session. */
interface ICaptureRecord {
  prompt: string;
  requestId?: string;
  callId?: string;
}

interface IUsageRow {
  call_id: string;
  trace_id: string;
  revision_id: string;
  content_sha256: string;
  skill_md: string;
  exaix_yaml: string | null;
  refs: string;
  root_kind: string;
  match_source: string;
  submission_kind: string;
  render_mode: string;
  skill_name: string;
}

interface IUsageRead {
  expected: (typeof approvedSkills)[number];
  rows: IUsageRow[];
  callIds: string[];
  result: IEvidenceResult;
}

/** Compares trusted expected revision, recorded usage, and a captured provider submission. */
export function verifySkillSubmission(
  expected: IExpectedSubmission,
  usage: IRecordedSubmission,
  capture: Opt<ISubmissionCapture, Reason.OptionalContext>,
): IEvidenceResult {
  if (!/^[a-f0-9]{64}$/.test(expected.sha256) || !expected.instructions || !usage.callId) {
    return { status: "failed", reasons: ["Invalid expected revision or usage identity"] };
  }
  if (
    usage.requestId !== expected.requestId || usage.skill !== expected.skill || usage.root !== expected.root ||
    usage.revision !== expected.revision || usage.sha256 !== expected.sha256 ||
    usage.submissionKind !== "provider" || usage.matchSource !== "pinned"
  ) return { status: "failed", reasons: ["Recorded usage does not match the expected pinned revision"] };
  if (!capture) return { status: "pending", reasons: ["Provider submission capture unavailable"] };
  if (
    capture.requestId !== expected.requestId || capture.callId !== usage.callId ||
    !capture.prompt.includes(expected.instructions)
  ) return { status: "failed", reasons: ["Captured submission does not match request, call, or skill instructions"] };
  return { status: "passed", reasons: [] };
}

function approvedFor(caseId: string): (typeof approvedSkills)[number] {
  const match = CASE_ID.exec(caseId);
  if (!match) throw new Error("Invalid case identity");
  return approvedSkills[Number(match[1]) - 1];
}

function failed(reasons: string[]): IEvidenceResult {
  return { status: "failed", reasons };
}

/** Loads and validates the request-bound usage rows without deciding whether a prompt exists. */
async function readValidatedUsage(root: string, caseId: string, requestId: string): Promise<IUsageRead> {
  if (!CASE_ID.test(caseId) || !REQUEST_ID.test(requestId)) throw new Error("Invalid case or request identity");
  const expected = approvedFor(caseId);
  const resolver = new PathResolver(createMockConfig(root));
  const path = await resolver.resolve("@Runtime/journal.db");
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        expected,
        rows: [],
        callIds: [],
        result: { status: "pending", reasons: ["Skill usage journal unavailable"] },
      };
    }
    throw error;
  }
  let rows: IUsageRow[];
  let callIds: string[];
  const db = new Database(path, { readonly: true });
  try {
    rows = db.prepare(
      'SELECT u.call_id, u.trace_id, u.revision_id, u.root_kind, u.match_source, u.submission_kind, u.render_mode, u.skill_name, r.content_sha256, r.skill_md, r.exaix_yaml, r."references" AS refs FROM skill_usage u JOIN skill_revisions r ON r.revision_id = u.revision_id WHERE u.request_id = ? AND u.skill_name = ?',
    ).all<IUsageRow>(requestId, expected.name);
    callIds = db.prepare("SELECT DISTINCT call_id FROM skill_usage WHERE request_id = ?").all<{ call_id: string }>(
      requestId,
    ).map((row) => row.call_id);
  } finally {
    db.close();
  }
  if (rows.length === 0) {
    return { expected, rows, callIds, result: { status: "pending", reasons: ["Skill usage unavailable"] } };
  }
  for (const row of rows) {
    if (
      !row.call_id || row.trace_id.slice(0, 8) !== requestId.slice(-8) || row.root_kind !== expected.root ||
      row.match_source !== "pinned" || row.submission_kind !== "provider"
    ) {
      return {
        expected,
        rows,
        callIds,
        result: failed(["Recorded skill usage has unexpected request, root, or submission identity"]),
      };
    }
    if (row.revision_id !== expected.revision || row.content_sha256 !== expected.sha256) {
      return { expected, rows, callIds, result: failed(["Recorded skill revision is not the approved revision"]) };
    }
    try {
      const snapshot = {
        skill_md: row.skill_md,
        exaix_yaml: row.exaix_yaml,
        references: ReferencesSchema.parse(JSON.parse(row.refs)),
      };
      const hash = await computeSkillContentSha256(snapshot);
      if (hash !== row.content_sha256 || await computeRevisionId(hash) !== row.revision_id) {
        return { expected, rows, callIds, result: failed(["Recorded skill snapshot does not match its revision"]) };
      }
    } catch {
      return { expected, rows, callIds, result: failed(["Recorded skill snapshot is malformed"]) };
    }
  }
  return { expected, rows, callIds, result: { status: "passed", reasons: [] } };
}

/** A valid usage row is only partial evidence. It does not capture the provider prompt. */
export async function observeRecordedSkill(root: string, caseId: string, requestId: string): Promise<IEvidenceResult> {
  const read = await readValidatedUsage(root, caseId, requestId);
  if (read.result.status !== "passed") return read.result;
  return { status: "pending", reasons: ["Recorded skill snapshot is valid; provider submission capture unavailable"] };
}

function instructionsFor(row: IUsageRow): string {
  const body = row.skill_md.replace(FRONTMATTER, "");
  return row.render_mode === "trimmed" ? stripExamplesSection(body) : body;
}

function parseCapture(
  raw: string,
  expected: (typeof approvedSkills)[number],
  requestId: string,
): ICaptureRecord {
  let parsed: ReturnType<typeof CaptureSchema.safeParse>;
  try {
    parsed = CaptureSchema.safeParse(JSON.parse(raw));
  } catch {
    throw new Error("Provider capture is malformed");
  }
  if (
    !parsed.success || parsed.data.skill !== expected.name || parsed.data.root !== expected.root ||
    parsed.data.revision !== expected.revision || parsed.data.sha256 !== expected.sha256
  ) throw new Error("Provider capture does not match the approved revision");
  if (parsed.data.requestId !== undefined && parsed.data.requestId !== requestId) {
    throw new Error("Provider capture identifies another request");
  }
  return { prompt: parsed.data.prompt, requestId: parsed.data.requestId, callId: parsed.data.callId };
}

async function readCapture(
  root: string,
  expected: (typeof approvedSkills)[number],
  requestId: string,
): Promise<ICaptureRecord | undefined> {
  const resolver = new PathResolver(createMockConfig(root));
  const candidates = [
    join(root, ".exa", "phase234-evidence", `${expected.name}-${requestId}-provider-prompt.json`),
    join(root, ".exa", "phase234-evidence", `${expected.name}-provider-prompt.json`),
  ];
  for (const candidate of candidates) {
    const path = await resolver.validatePath(candidate, [root]);
    let raw: string;
    try {
      raw = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    return parseCapture(raw, expected, requestId);
  }
  return undefined;
}

/** Binds a retained prompt to the request's journal submission. */
export async function bindRecordedSkillSubmission(
  root: string,
  caseId: string,
  requestId: string,
): Promise<ISkillSubmissionBinding> {
  const read = await readValidatedUsage(root, caseId, requestId);
  if (read.result.status !== "passed") return { expected: undefined, result: read.result };
  let captureRecord: ICaptureRecord | undefined;
  try {
    captureRecord = await readCapture(root, read.expected, requestId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Provider capture")) {
      return { expected: undefined, result: failed([error.message]) };
    }
    throw error;
  }
  if (captureRecord === undefined) {
    return { expected: undefined, result: { status: "pending", reasons: ["Provider submission capture unavailable"] } };
  }
  let row: IUsageRow | undefined;
  if (captureRecord.callId !== undefined) {
    row = read.rows.find((candidate) => candidate.call_id === captureRecord.callId);
    if (!row) {
      return {
        expected: undefined,
        result: failed(["Provider capture call identity is not a recorded submission"]),
      };
    }
  } else {
    if (read.callIds.length !== 1) {
      return {
        expected: undefined,
        result: { status: "pending", reasons: ["Request has multiple skill submissions; one call identity is needed"] },
      };
    }
    row = read.rows[0];
  }
  const expected: IExpectedSubmission = {
    requestId,
    skill: read.expected.name,
    root: read.expected.root,
    revision: read.expected.revision,
    sha256: read.expected.sha256,
    instructions: instructionsFor(row),
  };
  const usage: IRecordedSubmission = {
    requestId,
    skill: row.skill_name,
    root: row.root_kind,
    revision: row.revision_id,
    sha256: row.content_sha256,
    callId: row.call_id,
    submissionKind: row.submission_kind,
    matchSource: row.match_source,
  };
  const capture: ISubmissionCapture = { requestId, callId: row.call_id, prompt: captureRecord.prompt };
  return { expected, usage, capture, result: verifySkillSubmission(expected, usage, capture) };
}
