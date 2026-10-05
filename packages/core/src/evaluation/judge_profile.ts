/**
 * @module JudgeProfile
 * @path packages/core/src/evaluation/judge_profile.ts
 * @description Validate frozen plan judge profiles and compute scores from complete evidence responses.
 * @architectural-layer Core
 * @dependencies zod, @std/encoding/hex
 * @related-files [packages/core/src/evaluation/evaluation_criteria.ts]
 */

import { z } from "zod";
import { encodeHex } from "@std/encoding/hex";
import { CriterionResultSchema, type EvaluationResult, EvaluationResultSchema } from "@exaix/core/evaluation";
import type { JSONObject, JSONValue } from "@exaix/core/types";

export type ICandidateJudgeProfile = z.infer<typeof CandidateJudgeProfileSchema>;

export interface IResolvedJudgeProfile {
  readonly spec: ICandidateJudgeProfile;
  readonly methodology: string;
  readonly template: string;
  readonly profileHash: string;
}

const MAX_JSON_BYTES: number = 1_048_576;
const MAX_JSON_DEPTH: number = 128;
const MAX_CRITERION_WEIGHT: number = 10;
const PAYLOAD_SEPARATOR: string = "\n\n";
const INVALID_RESPONSE: string = "judge-profile-invalid-response";
const INSUFFICIENT_EVIDENCE: string = "judge-profile-insufficient-evidence";
const PLACEHOLDERS = ["request_context_json", "artifact_json", "criteria_json", "response_schema_json"] as const;
const CRITERION_NAMES = [
  "goal_alignment",
  "task_fulfillment",
  "request_understanding",
  "code_correctness",
  "code_completeness",
] as const;
const TextSchema = z.string().trim().min(1);
const AssetNameSchema = TextSchema.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/);
const AnchorSchema = z.object({
  "0": TextSchema,
  "0.25": TextSchema,
  "0.5": TextSchema,
  "0.75": TextSchema,
  "1": TextSchema,
}).strict();
const ProfileCriterionSchema = z.object({
  name: z.enum(CRITERION_NAMES),
  weight: z.number().finite().positive().max(MAX_CRITERION_WEIGHT),
  required: z.boolean(),
  category: z.enum(["completeness", "correctness"]),
  description: TextSchema,
  anchors: AnchorSchema,
}).strict();

export const CandidateJudgeProfileSchema = z.object({
  artifact_kind: z.literal("candidate-judge-profile"),
  format_version: z.literal(1),
  id: TextSchema,
  status: z.literal("candidate-not-active"),
  task_kind: z.literal("plan"),
  preset: z.literal("GOAL_ALIGNED_REVIEW"),
  criteria: z.array(ProfileCriterionSchema).length(CRITERION_NAMES.length).refine(
    (criteria) => criteria.every((entry, index: number) => entry.name === CRITERION_NAMES[index]),
  ),
  weight_origin: TextSchema,
  label_threshold: z.number().finite().min(0).max(1),
  aggregation: z.literal("complete-criterion-weighted-mean"),
  score_range: z.tuple([z.literal(0), z.literal(1)]),
  anchor_policy: z.literal("continuous-with-evidence-based-interpolation"),
  required_tag_semantics: z.literal("legacy metadata; no additional veto; all result keys must be present"),
  samples_per_vendor_per_artifact: z.literal(1),
  retry_count: z.literal(0),
  methodology_assets: z.array(AssetNameSchema).nonempty().refine((names: string[]) =>
    new Set(names).size === names.length
  ),
  prompt_asset: AssetNameSchema,
  asset_extraction: z.literal("exactly-one-fenced-text-payload"),
  payload_separator: z.literal(PAYLOAD_SEPARATOR),
  placeholders: z.tuple(PLACEHOLDERS.map((name) => z.literal(name)) as [
    z.ZodLiteral<"request_context_json">,
    z.ZodLiteral<"artifact_json">,
    z.ZodLiteral<"criteria_json">,
    z.ZodLiteral<"response_schema_json">,
  ]),
  examples_submitted: z.literal(false),
  ambient_methodology_appended: z.literal(false),
  insufficient_evidence: z.object({
    error: z.literal("insufficient_evidence"),
    missingEvidence: TextSchema,
  }).strict(),
  provider_policy: z.object({
    target: z.literal("claude-cli"),
    reference: z.literal("codex-cli"),
    model_identifiers: TextSchema,
    settings: TextSchema,
  }).strict(),
  activation: TextSchema,
  sources: z.array(z.string().url()).nonempty(),
}).strict().refine((spec) => !spec.methodology_assets.includes(spec.prompt_asset));

const StrictResultSchema = EvaluationResultSchema.extend({
  criteriaScores: z.record(
    z.string(),
    CriterionResultSchema.extend({
      score: z.number().finite().min(0).max(1),
      reasoning: TextSchema,
    }).strict(),
  ),
  metadata: EvaluationResultSchema.shape.metadata.unwrap().strict().optional(),
}).strict();
const InsufficientEvidenceSchema = z.object({
  error: z.literal("insufficient_evidence"),
  missingEvidence: z.array(TextSchema).nonempty(),
}).strict();

export class JudgeProfileError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "JudgeProfileError";
  }
}

/** Reject duplicate JSON keys before parsing, including escaped representations of the same key. */
function parseUniqueJson(raw: string): JSONValue {
  if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) throw new JudgeProfileError(INVALID_RESPONSE);
  let parsed: JSONValue;
  try {
    parsed = JSON.parse(raw) as JSONValue;
  } catch {
    throw new JudgeProfileError(INVALID_RESPONSE);
  }
  const tokens: string[] = raw.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g) ?? [];
  const objects: Array<Set<string> | null> = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "{" || token === "[") {
      objects.push(token === "{" ? new Set<string>() : null);
      if (objects.length > MAX_JSON_DEPTH) throw new JudgeProfileError(INVALID_RESPONSE);
    } else if (token === "}" || token === "]") {
      objects.pop();
    } else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys: Set<string> | null | undefined = objects.at(-1);
      if (keys) {
        const key: string = JSON.parse(token) as string;
        if (keys.has(key)) throw new JudgeProfileError("judge-profile-duplicate-key");
        keys.add(key);
      }
    }
  }
  return parsed;
}

/** Keep parsed profile data immutable after computing its identity. */
function freezeJson<T extends JSONValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function extractJudgeInstructionPayload(asset: string): string {
  const payloads: RegExpMatchArray[] = [...asset.matchAll(/^```text\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (payloads.length !== 1 || !payloads[0][1].trim()) throw new JudgeProfileError("judge-profile-invalid-payload");
  return payloads[0][1].replace(/\r?\n$/, "");
}

export function parseCandidateJudgeProfile(rawSpec: string): ICandidateJudgeProfile {
  const result = CandidateJudgeProfileSchema.safeParse(parseUniqueJson(rawSpec));
  if (!result.success) throw new JudgeProfileError("judge-profile-invalid-spec");
  return result.data;
}

export async function resolveJudgeProfile(
  rawSpec: string,
  assets: Record<string, string>,
): Promise<IResolvedJudgeProfile> {
  const spec: ICandidateJudgeProfile = parseCandidateJudgeProfile(rawSpec);
  const paths: string[] = [...spec.methodology_assets, spec.prompt_asset];
  const rawAssets: string[] = paths.map((path: string): string => {
    if (!Object.hasOwn(assets, path)) throw new JudgeProfileError("judge-profile-missing-asset");
    return assets[path];
  });
  const payloads: string[] = rawAssets.map(extractJudgeInstructionPayload);
  const template: string = payloads.at(-1)!;
  const names: string[] = [...template.matchAll(/\{\{([^{}]+)\}\}/g)].map((match: RegExpMatchArray): string =>
    match[1]
  );
  if (
    names.length !== PLACEHOLDERS.length ||
    PLACEHOLDERS.some((name) => names.filter((value: string) => value === name).length !== 1)
  ) {
    throw new JudgeProfileError("judge-profile-invalid-template");
  }
  const identity: string = JSON.stringify({ rawSpec, paths, rawAssets, renderer: "json-line-numbered-single-pass-v1" });
  const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Object.freeze({
    spec: freezeJson(spec),
    methodology: payloads.slice(0, -1).join(PAYLOAD_SEPARATOR),
    template,
    profileHash: encodeHex(digest),
  });
}

export function renderJudgeProfilePrompt(
  profile: IResolvedJudgeProfile,
  requestContext: string,
  artifact: string,
  responseSchema: JSONObject,
): string {
  if (!requestContext.trim() || !artifact.trim()) throw new JudgeProfileError(INSUFFICIENT_EVIDENCE);
  const numbered: string = artifact.split("\n").map((line: string, index: number): string => `${index + 1}. ${line}`)
    .join("\n");
  const values: Record<string, string> = {
    request_context_json: JSON.stringify(requestContext),
    artifact_json: JSON.stringify(numbered),
    criteria_json: JSON.stringify(profile.spec.criteria),
    response_schema_json: JSON.stringify(responseSchema),
  };
  const rendered: string = profile.template.replace(
    /\{\{([a-z_]+)\}\}/g,
    (_match: string, name: string): string => values[name],
  );
  return profile.methodology + PAYLOAD_SEPARATOR + rendered;
}

export function parseJudgeProfileResponse(raw: string, profile: IResolvedJudgeProfile): EvaluationResult {
  const input: JSONValue = parseUniqueJson(raw);
  if (InsufficientEvidenceSchema.safeParse(input).success) throw new JudgeProfileError(INSUFFICIENT_EVIDENCE);
  const parsed = StrictResultSchema.safeParse(input);
  if (!parsed.success) throw new JudgeProfileError(INVALID_RESPONSE);
  const result: EvaluationResult = parsed.data;
  const keys: string[] = Object.keys(result.criteriaScores);
  if (
    keys.length !== profile.spec.criteria.length ||
    profile.spec.criteria.some((entry) => !Object.hasOwn(result.criteriaScores, entry.name))
  ) {
    throw new JudgeProfileError(INVALID_RESPONSE);
  }
  let sum: number = 0;
  let weight: number = 0;
  for (const criterion of profile.spec.criteria) {
    const score = result.criteriaScores[criterion.name];
    if (score.name !== undefined && score.name !== criterion.name) throw new JudgeProfileError(INVALID_RESPONSE);
    score.passed = score.score >= profile.spec.label_threshold;
    sum += score.score * criterion.weight;
    weight += criterion.weight;
  }
  result.overallScore = sum / weight;
  result.pass = result.overallScore >= profile.spec.label_threshold;
  return result;
}
