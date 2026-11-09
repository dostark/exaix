#!/usr/bin/env -S deno run -A
/**
 * @module SkillEvaluationEvidence
 * @path tests/scenario_framework/runner/skill_evaluation_evidence.ts
 * @description Separates delivery, behavior, artifact, and observed workspace results.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_evaluation_evidence_test.ts]
 */
import { join, relative } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { parseStructuredPlanFromMarkdown } from "@exaix/core/planning";
import { z } from "zod";
import { readRequirementsArtifact } from "./requirements_artifact.ts";
import type { Opt, Reason } from "@exaix/core/types";
import {
  bindRecordedSkillSubmission,
  type IExpectedSubmission,
  type IRecordedSubmission,
  type ISubmissionCapture,
  verifySkillSubmission,
} from "./skill_delivery_observation.ts";

export type EvidenceStatus = "passed" | "failed" | "pending";
export interface IEvidenceResult {
  status: EvidenceStatus;
  reasons: string[];
}
export interface IPhase234Evidence {
  delivery: IEvidenceResult;
  behavior: IEvidenceResult;
  artifact: IEvidenceResult;
  workspace: IEvidenceResult;
  commands: IEvidenceResult;
}
export interface IBehaviorEvidence extends IEvidenceResult {
  deterministic: IEvidenceResult | { status: "not_applicable"; reasons: string[] };
  semantic: IEvidenceResult;
}
export interface IObservedEffects extends IEvidenceResult {
  artifact: IEvidenceResult;
  workspace: IEvidenceResult;
  commands: IEvidenceResult;
}
export interface IPhase234Evaluation {
  delivery: IEvidenceResult;
  behavior: IBehaviorEvidence;
  effects: IObservedEffects;
  overall: EvidenceStatus;
}
export interface IWorkspaceEntry {
  kind: "file" | "symlink";
  fingerprint: string;
}
export type IWorkspaceSnapshot = Record<string, IWorkspaceEntry>;
export interface IWorkspaceChange {
  path: string;
  kind: "added" | "removed" | "modified";
}
export interface ICommandObservation {
  requestId: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
}
/** The expected command, its independent observations, and the resulting verdict. */
export interface ICommandEvidenceBundle {
  expected?: ICommandObservation;
  observed: ICommandObservation[];
  result: IEvidenceResult;
}
export interface ISemanticExpectation {
  caseId: string;
  artifactSha256: string;
  rubricSha256: string;
  producer: string;
  positiveControls: string[];
  negativeControls: string[];
  calibrationPolicy?: {
    approvedBy: string;
    minimumPositive: number;
    minimumNegative: number;
  };
}
export interface ISemanticReview {
  caseId: string;
  artifactSha256: string;
  rubricSha256: string;
  reviewer: string;
  evaluator: string;
  verdict: EvidenceStatus;
  rationale: string;
}
export interface ICalibrationControl {
  id: string;
  expected: "passed" | "failed";
  observed: "passed" | "failed";
}
export interface ISemanticCalibration {
  rubricSha256: string;
  evaluator: string;
  controls: ICalibrationControl[];
}
export interface IVerifiedEvaluationInput {
  caseId: string;
  requestId: string;
  artifact: string;
  expectedSubmission: IExpectedSubmission;
  usage: IRecordedSubmission | undefined;
  capture: ISubmissionCapture | undefined;
  expectation: ISemanticExpectation;
  review: ISemanticReview | undefined;
  calibration: ISemanticCalibration | undefined;
  expectedCommand: ICommandObservation | undefined;
  observedCommands: ICommandObservation[];
  workspace: IEvidenceResult;
}

/** Validates trusted review and calibration records. Callers must authenticate their provenance. */
export function verifySemanticReview(
  expected: ISemanticExpectation,
  review: Opt<ISemanticReview, Reason.OptionalContext>,
  calibration: Opt<ISemanticCalibration, Reason.OptionalContext>,
): IEvidenceResult {
  if (!review || !calibration) return { status: "pending", reasons: ["Independent review or calibration unavailable"] };
  const policy = expected.calibrationPolicy;
  if (!policy) return { status: "pending", reasons: ["Approved calibration policy unavailable"] };
  if (
    !/^[a-f0-9]{64}$/.test(expected.artifactSha256) || !/^[a-f0-9]{64}$/.test(expected.rubricSha256) ||
    review.caseId !== expected.caseId || review.artifactSha256 !== expected.artifactSha256 ||
    review.rubricSha256 !== expected.rubricSha256 || calibration.rubricSha256 !== expected.rubricSha256 ||
    !review.reviewer || !review.evaluator || !review.rationale || !expected.producer || !policy.approvedBy ||
    review.reviewer === expected.producer || review.evaluator === expected.producer ||
    review.reviewer === review.evaluator || policy.approvedBy === expected.producer ||
    policy.approvedBy === review.evaluator || calibration.evaluator !== review.evaluator ||
    !Number.isSafeInteger(policy.minimumPositive) || policy.minimumPositive < 1 ||
    !Number.isSafeInteger(policy.minimumNegative) || policy.minimumNegative < 1
  ) return { status: "failed", reasons: ["Review identity, rubric, artifact, or independence does not match"] };
  const expectedControls = new Map<string, "passed" | "failed">();
  for (const id of expected.positiveControls) {
    if (expectedControls.has(id)) return { status: "failed", reasons: ["Calibration control identity is duplicated"] };
    expectedControls.set(id, "passed");
  }
  for (const id of expected.negativeControls) {
    if (expectedControls.has(id)) return { status: "failed", reasons: ["Calibration control identity is duplicated"] };
    expectedControls.set(id, "failed");
  }
  if (
    expected.positiveControls.length < policy.minimumPositive ||
    expected.negativeControls.length < policy.minimumNegative
  ) {
    return { status: "pending", reasons: ["Approved calibration control minimum is not met"] };
  }
  const controls = new Map<string, ICalibrationControl>();
  for (const control of calibration.controls) {
    if (controls.has(control.id)) return { status: "failed", reasons: ["Calibration control identity is duplicated"] };
    controls.set(control.id, control);
  }
  for (const [id, label] of expectedControls) {
    const control = controls.get(id);
    if (!control) return { status: "pending", reasons: [`Calibration control ${id} is missing`] };
    if (control.expected !== label || control.observed !== label) {
      return { status: "failed", reasons: [`Calibration control ${id} did not meet its reference label`] };
    }
  }
  return { status: review.verdict, reasons: review.verdict === "passed" ? [] : [review.rationale] };
}

/** Checks independently recorded execution against the case's expected command and result. */
export function verifyCommandObservation(
  expected: ICommandObservation,
  observations: ICommandObservation[],
): IEvidenceResult {
  const matching = observations.filter((observation) =>
    observation.requestId === expected.requestId && observation.cwd === expected.cwd &&
    JSON.stringify(observation.argv) === JSON.stringify(expected.argv)
  );
  if (matching.length === 0) return { status: "pending", reasons: ["Requested command has not been observed"] };
  if (
    matching.some((observation) => observation.exitCode !== expected.exitCode || observation.stdout !== expected.stdout)
  ) {
    return { status: "failed", reasons: ["Observed command result differs from the case expectation"] };
  }
  return { status: "passed", reasons: [] };
}

const COMMAND_CASE = /^p234-s[1-6]-c[1-5]$/;
const CommandObservationSchema = z.object({
  requestId: z.string().regex(/^request-[a-f0-9]{8}$/),
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1),
  exitCode: z.number().int(),
  stdout: z.string(),
}).strict();
const CommandBundleSchema = z.object({
  expected: CommandObservationSchema.optional(),
  observed: z.array(CommandObservationSchema),
}).strict();

/** Loads a case's bound command evidence without treating model self-report as execution. */
export async function loadCommandEvidence(root: string, caseId: string): Promise<ICommandEvidenceBundle> {
  if (!COMMAND_CASE.test(caseId)) throw new Error("Invalid case identity");
  const resolver = new PathResolver(createMockConfig(root));
  const path = await resolver.validatePath(
    join(root, ".exa", "phase234-evidence", `${caseId}-commands.json`),
    [root],
  );
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { observed: [], result: { status: "pending", reasons: ["Command execution evidence unavailable"] } };
    }
    throw error;
  }
  const parsed = CommandBundleSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return { observed: [], result: { status: "failed", reasons: ["Command evidence is malformed"] } };
  }
  if (!parsed.data.expected) {
    return {
      observed: parsed.data.observed,
      result: { status: "pending", reasons: ["No independent command expectation"] },
    };
  }
  return {
    expected: parsed.data.expected,
    observed: parsed.data.observed,
    result: verifyCommandObservation(parsed.data.expected, parsed.data.observed),
  };
}

function combine(results: IEvidenceResult[]): IEvidenceResult {
  const status = results.some((result) => result.status === "failed")
    ? "failed"
    : results.some((result) => result.status === "pending")
    ? "pending"
    : "passed";
  return { status, reasons: results.flatMap((result) => result.reasons) };
}

const PlanIdentitySchema = z.object({
  request_id: z.string().min(1),
  trace_id: z.string().uuid(),
  agent_role: z.string().optional(),
});

/** Checks the artifact using the product's structured-plan parser. */
export function checkPlanFormat(artifact: string, expectedRequestId: string | undefined = undefined): IEvidenceResult {
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(artifact);
  if (!header) return { status: "failed", reasons: ["Plan frontmatter is missing"] };
  try {
    const identity = PlanIdentitySchema.safeParse(parseYaml(header[1]));
    const body = artifact.slice(header[0].length);
    if (
      !identity.success ||
      `request-${identity.data.trace_id.slice(0, 8)}` !== identity.data.request_id ||
      (expectedRequestId !== undefined && identity.data.request_id !== expectedRequestId) ||
      !/^#\s+\S/m.test(body) || !parseStructuredPlanFromMarkdown(body, identity.data)
    ) {
      return { status: "failed", reasons: ["Plan cannot be read as a structured product artifact"] };
    }
    return { status: "passed", reasons: [] };
  } catch {
    return { status: "failed", reasons: ["Plan frontmatter or body is malformed"] };
  }
}

/** Aggregates only observed results. Pending evidence never produces a pass. */
export function evaluatePhase234(evidence: IPhase234Evidence): IPhase234Evaluation {
  const effects: IObservedEffects = {
    ...combine([evidence.artifact, evidence.workspace, evidence.commands]),
    artifact: evidence.artifact,
    workspace: evidence.workspace,
    commands: evidence.commands,
  };
  return {
    delivery: evidence.delivery,
    behavior: {
      ...evidence.behavior,
      deterministic: { status: "pending", reasons: ["No deterministic facts supplied"] },
      semantic: evidence.behavior,
    },
    effects,
    overall: combine([evidence.delivery, evidence.behavior, effects]).status,
  };
}

const CountRecordSchema = z.object({
  case_id: z.string(),
  acceptance: z.array(z.object({ input: z.number().optional(), expected: z.string().optional() }).passthrough()),
}).passthrough();
const COUNT_OUTCOMES = [[0, "0 items"], [1, "1 item"], [2, "2 items"]] as const;

/** Checks explicit examples only when a machine-readable record is available. */
export function checkDeterministicBehavior(
  caseId: string,
  artifact: string,
): IEvidenceResult | { status: "not_applicable"; reasons: string[] } {
  if (caseId !== "p234-s5-c1") return { status: "pending", reasons: ["No deterministic fact check is available"] };
  const blocks = [...artifact.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) return { status: "not_applicable", reasons: ["Count examples require semantic review"] };
  let record: z.infer<typeof CountRecordSchema>;
  try {
    const parsed = CountRecordSchema.safeParse(JSON.parse(blocks[0][1]));
    if (!parsed.success) return { status: "not_applicable", reasons: ["Count examples require semantic review"] };
    record = parsed.data;
  } catch {
    return { status: "not_applicable", reasons: ["Count examples require semantic review"] };
  }
  if (record.case_id !== caseId) return { status: "failed", reasons: ["Record identifies another case"] };
  for (const [input, expected] of COUNT_OUTCOMES) {
    const observed = record.acceptance.filter((entry) => entry.input === input);
    if (observed.some((entry) => entry.expected !== expected)) {
      return { status: "failed", reasons: [`Incorrect output for count ${input}`] };
    }
    if (observed.length === 0) {
      return { status: "not_applicable", reasons: [`Count ${input} requires semantic review`] };
    }
  }
  return { status: "passed", reasons: [] };
}

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Evaluates trusted evidence after binding it to the actual request and artifact bytes. */
export async function evaluateVerifiedEvidence(input: IVerifiedEvaluationInput): Promise<IPhase234Evaluation> {
  const artifactHash = await fingerprint(new TextEncoder().encode(input.artifact));
  const deterministic = checkDeterministicBehavior(input.caseId, input.artifact);
  const semantic = input.expectation.caseId !== input.caseId || input.expectation.artifactSha256 !== artifactHash
    ? { status: "failed" as const, reasons: ["Semantic evidence does not identify this case and artifact"] }
    : verifySemanticReview(input.expectation, input.review, input.calibration);
  const delivery = input.expectedSubmission.requestId !== input.requestId
    ? { status: "failed" as const, reasons: ["Expected submission identifies another request"] }
    : input.usage
    ? verifySkillSubmission(input.expectedSubmission, input.usage, input.capture)
    : { status: "pending" as const, reasons: ["Request-bound skill usage unavailable"] };
  const commands = !input.expectedCommand
    ? { status: "pending" as const, reasons: ["No independent command expectation"] }
    : input.expectedCommand.requestId !== input.requestId
    ? { status: "failed" as const, reasons: ["Expected command identifies another request"] }
    : verifyCommandObservation(input.expectedCommand, input.observedCommands);
  const result = evaluatePhase234({
    delivery,
    behavior: deterministic.status === "not_applicable" ? semantic : combine([deterministic, semantic]),
    artifact: checkPlanFormat(input.artifact, input.requestId),
    workspace: input.workspace,
    commands,
  });
  result.behavior.deterministic = deterministic;
  result.behavior.semantic = semantic;
  return result;
}

/** Observes portal files without following symbolic links or inspecting Git metadata. */
export async function snapshotWorkspace(root: string, portal: string): Promise<IWorkspaceSnapshot> {
  const resolver = new PathResolver(createMockConfig(root));
  const base = await resolver.validatePath(portal, [root]);
  const entries: IWorkspaceSnapshot = {};
  async function visit(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      if (directory === base && entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const name = relative(base, path);
      if (entry.isSymlink) {
        entries[name] = { kind: "symlink", fingerprint: await Deno.readLink(path) };
      } else if (entry.isDirectory) {
        await visit(await resolver.validatePath(path, [base]));
      } else if (entry.isFile) {
        const safe = await resolver.validatePath(path, [base]);
        const mode = (await Deno.stat(safe)).mode;
        entries[name] = { kind: "file", fingerprint: `${mode}:${await fingerprint(await Deno.readFile(safe))}` };
      } else {
        throw new Error(`Unsupported workspace entry: ${name}`);
      }
    }
  }
  await visit(base);
  return entries;
}

/** Compares actual file observations, including untracked files and symlinks. */
export function compareWorkspaceSnapshots(before: IWorkspaceSnapshot, after: IWorkspaceSnapshot): IWorkspaceChange[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: IWorkspaceChange[] = [];
  for (const path of paths) {
    const oldEntry = before[path];
    const newEntry = after[path];
    if (!oldEntry) changes.push({ path, kind: "added" });
    else if (!newEntry) changes.push({ path, kind: "removed" });
    else if (oldEntry.kind !== newEntry.kind || oldEntry.fingerprint !== newEntry.fingerprint) {
      changes.push({ path, kind: "modified" });
    }
  }
  return changes;
}

const CASE_ID = /^p234-s[1-6]-c[1-5]$/;
const BaselineSchema = z.object({
  caseId: z.string().regex(CASE_ID),
  files: z.record(z.string(), z.object({ kind: z.enum(["file", "symlink"]), fingerprint: z.string() }).strict()),
}).strict();

async function baselinePath(root: string, caseId: string): Promise<string> {
  if (!CASE_ID.test(caseId)) throw new Error("Invalid case identity");
  const resolver = new PathResolver(createMockConfig(root));
  return await resolver.validatePath(join(root, ".exa", "phase234-baselines", `${caseId}.json`), [root]);
}

function casePortal(root: string, caseId: string): string {
  const group = Number(caseId[6]);
  return join(root, group <= 4 ? `p234-s${group}` : caseId);
}

/** Saves a pre-request snapshot once, before a case can change its portal. */
export async function captureWorkspaceBaseline(root: string, caseId: string): Promise<void> {
  const path = await baselinePath(root, caseId);
  const files = await snapshotWorkspace(root, casePortal(root, caseId));
  await Deno.mkdir(join(root, ".exa", "phase234-baselines"), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify({ caseId, files }), { createNew: true, mode: 0o600 });
}

/** Compares the current portal with its case-bound, pre-request baseline. */
export async function observeWorkspaceChanges(root: string, caseId: string): Promise<IEvidenceResult> {
  const path = await baselinePath(root, caseId);
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "pending", reasons: ["Workspace baseline unavailable"] };
    }
    throw error;
  }
  const baseline = BaselineSchema.parse(JSON.parse(raw));
  if (baseline.caseId !== caseId) throw new Error("Workspace baseline case mismatch");
  const current = await snapshotWorkspace(root, casePortal(root, caseId));
  const changes = compareWorkspaceSnapshots(baseline.files, current);
  if (changes.length > 0) {
    return { status: "pending", reasons: changes.map((change) => `${change.kind}: ${change.path}`) };
  }
  return { status: "pending", reasons: ["Case portal unchanged; other workspace paths were not inspected"] };
}

/** Reports observed artifacts without treating a legacy record verdict as semantic proof. */
export async function evaluateObservedArtifacts(
  root: string,
  caseId: string,
  artifacts: string[],
  requestIds: string[] = [],
): Promise<IPhase234Evaluation> {
  const workspace = await observeWorkspaceChanges(root, caseId);
  const artifact = artifacts.length === 0
    ? { status: "failed" as const, reasons: ["No plan artifact was supplied"] }
    : requestIds.length !== artifacts.length
    ? { status: "pending" as const, reasons: ["Artifact request identities unavailable"] }
    : combine(artifacts.map((item, index) => checkPlanFormat(item, requestIds[index])));
  const deterministic = checkDeterministicBehavior(caseId, artifacts.at(-1) ?? "");
  const semantic: IEvidenceResult = { status: "pending", reasons: ["Independent semantic review is required"] };
  const delivery = requestIds.length === artifacts.length && requestIds.length > 0
    ? combine(
      (await Promise.all(requestIds.map((id) => bindRecordedSkillSubmission(root, caseId, id)))).map((item) =>
        item.result
      ),
    )
    : { status: "pending" as const, reasons: ["Request-bound skill usage unavailable"] };
  const commands = (await loadCommandEvidence(root, caseId)).result;
  const evaluation = evaluatePhase234({
    delivery,
    behavior: deterministic.status === "not_applicable" ? semantic : combine([deterministic, semantic]),
    artifact,
    workspace,
    commands,
  });
  evaluation.behavior.deterministic = deterministic;
  evaluation.behavior.semantic = semantic;
  return evaluation;
}

if (import.meta.main) {
  const [command, root, caseId, requestId] = Deno.args;
  if (!root || !caseId || (command !== "baseline" && command !== "evaluate")) {
    throw new Error("Usage: skill_evaluation_evidence.ts baseline|evaluate <root> <case> [request-id]");
  }
  if (command === "baseline") {
    await captureWorkspaceBaseline(root, caseId);
    console.log(JSON.stringify({ caseId, baseline: "captured" }));
  } else {
    if (!requestId) throw new Error("Evaluation requires a request identity");
    const artifact = await readRequirementsArtifact(root, requestId);
    const evaluation = await evaluateObservedArtifacts(root, caseId, [artifact], [requestId]);
    console.log(JSON.stringify({ caseId, requestId, evaluation }));
    if (evaluation.overall !== "passed") Deno.exit(1);
  }
}
