/**
 * @module PersonaResponseTrial
 * @path tests/scenario_framework/runner/persona_response_trial.ts
 * @description Validates durable per-trial response scores without substituting suite scores.
 * @architectural-layer Test
 * @related-files [scripts/run_persona_isolation.ts, tests/scenario_framework/runner/main.ts]
 */
import { z } from "zod";
import { join } from "@std/path";
import { CriterionResultSchema } from "../schema/step_schema.ts";
import type { IPersonaRoleResponseEvidence } from "./persona_response_evidence.ts";
import type { IRunManifest } from "./evidence_collector.ts";
import type { PersonaVariant } from "./persona_isolation_arm.ts";

export interface IPersonaTrialExpectation {
  experimentId: string;
  taskId: string;
  trialIndex: number;
  variant: PersonaVariant;
  provider: string;
  model: string;
  agentRole: string;
}

export interface IPersonaTrialSnapshot {
  runId: string;
  manifest: IRunManifest;
  evidence: IPersonaRoleResponseEvidence;
}

const EvidenceSchema = z.object({
  traceId: z.string().uuid(),
  agentRole: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  experimentId: z.string().min(1),
  taskId: z.string().min(1),
  trialIndex: z.number().int().nonnegative(),
  variant: z.enum(["shipped", "generic", "empty"]),
  runId: z.string().uuid(),
  responseRowid: z.number().int().positive(),
  planPath: z.string().min(1),
  content: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawResponseHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const SnapshotSchema = z.object({
  runId: z.string().uuid(),
  evidence: EvidenceSchema,
  manifest: z.object({
    scenarioId: z.string(),
    provider: z.string().optional(),
    model: z.string().optional(),
    steps: z.array(
      z.object({
        stepId: z.string(),
        criterionResults: z.array(CriterionResultSchema),
      }).passthrough(),
    ),
  }).passthrough(),
});

/** Rejects malformed capture or judge records, retaining valid failed and zero-score judgments. */
export async function readPersonaResponseTrial(
  path: string,
  expected: IPersonaTrialExpectation,
): Promise<{ score: number; runId: string; traceId: string }> {
  const snapshot = SnapshotSchema.parse(JSON.parse(await Deno.readTextFile(path)));
  return await validatePersonaResponseTrial(snapshot, expected);
}

async function validatePersonaResponseTrial(
  snapshot: z.infer<typeof SnapshotSchema>,
  expected: IPersonaTrialExpectation,
): Promise<{ score: number; runId: string; traceId: string }> {
  for (const key of Object.keys(expected) as (keyof IPersonaTrialExpectation)[]) {
    if (snapshot.evidence[key] !== expected[key]) throw new Error(`Persona trial provenance drift: ${key}`);
  }
  if (
    snapshot.runId !== snapshot.evidence.runId || snapshot.manifest.scenarioId !== expected.taskId ||
    (snapshot.manifest.provider !== undefined && snapshot.manifest.provider !== expected.provider) ||
    (snapshot.manifest.model !== undefined && snapshot.manifest.model !== expected.model)
  ) {
    throw new Error("Persona manifest provenance drift");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot.evidence.content));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== snapshot.evidence.contentHash) throw new Error("Persona response content hash mismatch");
  const captures = snapshot.manifest.steps.filter((step) => step.stepId === "capture-role-response");
  if (
    captures.length !== 1 ||
    !captures[0].criterionResults.some((result) =>
      result.criterion_id === "response-captured" && result.status === "passed"
    )
  ) {
    throw new Error("Missing valid persona response capture");
  }
  const criteria = snapshot.manifest.steps.flatMap((step) => step.criterionResults)
    .filter((result) => result.criterion_id === "persona-response-quality");
  if (criteria.length !== 1) throw new Error("Missing or duplicate persona response judge criterion");
  const criterion = criteria[0];
  if (
    criterion.kind !== "llm-judge" || !["passed", "failed"].includes(criterion.status) ||
    criterion.score === undefined ||
    criterion.judge?.provider !== expected.provider || criterion.judge.model !== expected.model
  ) {
    throw new Error("Invalid or drifted persona response judgment");
  }
  return { score: criterion.score, runId: snapshot.runId, traceId: snapshot.evidence.traceId };
}

/** Reuses a previously persisted trial instead of re-running a costly, already-completed live trial. */
export async function readCachedPersonaTrialSnapshot(
  outputDir: string,
  taskId: string,
  trial: number,
): Promise<IPersonaTrialSnapshot | undefined> {
  const path = join(outputDir, "persona-trials", taskId, `trial-${trial}.json`);
  try {
    const snapshot: IPersonaTrialSnapshot = JSON.parse(await Deno.readTextFile(path));
    await validatePersonaResponseTrial(SnapshotSchema.parse(snapshot), {
      experimentId: snapshot.evidence.experimentId,
      taskId,
      trialIndex: trial,
      variant: snapshot.evidence.variant,
      provider: snapshot.evidence.provider,
      model: snapshot.evidence.model,
      agentRole: snapshot.evidence.agentRole,
    });
    return snapshot;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Freezes the observed manifest alongside its exact response evidence before output reuse. */
export async function writePersonaResponseTrial(
  path: string,
  runId: string,
  manifest: IRunManifest,
  evidence: IPersonaRoleResponseEvidence,
): Promise<void> {
  const snapshot = { runId, manifest, evidence };
  await validatePersonaResponseTrial(SnapshotSchema.parse(snapshot), {
    experimentId: evidence.experimentId,
    taskId: evidence.taskId,
    trialIndex: evidence.trialIndex,
    variant: evidence.variant,
    provider: evidence.provider,
    model: evidence.model,
    agentRole: evidence.agentRole,
  });
  await Deno.writeTextFile(path, JSON.stringify(snapshot, null, 2), { createNew: true });
}
