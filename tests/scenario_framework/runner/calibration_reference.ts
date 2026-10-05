/**
 * @module ScenarioFrameworkCalibrationReference
 * @path tests/scenario_framework/runner/calibration_reference.ts
 * @description Phase 146 Step 1's cross-provider reference evaluator: scores a
 *   calibration item against the same frozen rubric the target judge uses, via a
 *   live CLI-delegate call to an explicitly named vendor/model, blind to the
 *   target's own score/verdict. Reuses buildEvaluationPrompt/calculateWeightedScore
 *   (the same scoring semantics assertions.ts's evaluateLlmJudgeCriterion uses) and
 *   callLlmEndpoint's provider/model resolution — no independent scorer or prompt path.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, packages/eval-history/src/calibration/metrics.ts]
 */

import {
  buildEvaluationPrompt,
  calculateWeightedScore,
  CriterionResultSchema as JudgeResponseSchema,
  EvaluationResultSchema,
  resolveCriterionPreset,
} from "@exaix/core/evaluation";
import { getCriterionResultJsonSchema, getEvaluationResultJsonSchema } from "@exaix/schemas/evaluation_json_schema.ts";
import { deriveCalibrationLabel } from "@exaix/eval-history";
import type { CalibrationLabel, ICalibrationRubric } from "@exaix/eval-history";
import type { JSONValue, Opt, Reason } from "@exaix/core/types";
import type { IResolvedBinding } from "@exaix/schemas";
import { callLlmEndpoint } from "./assertions.ts";
import type { ILlmEndpointResolvedMetadata } from "./assertions.ts";
import { resolveSandboxCli, runSandboxedCliCall, stripProviderPrefix } from "./calibration_sandbox.ts";
import type {
  ICalibrationReferenceAdapter,
  ICalibrationVendorTarget,
  IJudgeScoreResult,
} from "./calibration_runner.ts";
import type { ICalibrationSourceItem } from "./calibration_sources.ts";

export interface IReferenceEvaluationInput {
  readonly requestContext: string;
  readonly artifact: string;
  readonly preset: string;
  readonly labelThreshold: number;
  readonly referenceProvider: string;
  readonly referenceModel: string;
  readonly judgeBinding?: Opt<IResolvedBinding, Reason.OptionalDependency>;
}

export interface IReferenceEvaluationResult {
  readonly score: number;
  readonly label: CalibrationLabel;
  readonly rationale: string;
  readonly provider: string;
  readonly model: string;
}

export class ReferenceEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceEvaluationError";
  }
}

/** Strips a ```json fenced code block wrapper, if present — the exact cleanup
 *  evaluateLlmJudgeCriterion applies to the target judge's raw response. */
function stripCodeFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
}

/** The rubric prompt AND whether it's a multi-criteria preset — shared verbatim by
 *  every reference execution path (unsandboxed or sandboxed) so neither can drift
 *  into an independent scorer. Throws on an unknown/empty preset. */
export function buildReferencePrompt(
  requestContext: string,
  artifact: string,
  preset: string,
): { prompt: string; isMulti: boolean; jsonSchema: Record<string, JSONValue> } {
  const criteria = resolveCriterionPreset(preset);
  if (criteria.length === 0) {
    throw new ReferenceEvaluationError(`Unknown or empty preset: "${preset}"`);
  }
  const isMulti = criteria.length > 1;
  return {
    prompt: buildEvaluationPrompt(artifact, criteria, requestContext, isMulti),
    isMulti,
    jsonSchema: isMulti ? getEvaluationResultJsonSchema() : getCriterionResultJsonSchema(),
  };
}

/** Parses a reference evaluator's raw response into a score/label/rationale, using the
 *  exact scoring semantics (calculateWeightedScore) the target judge uses. Throws
 *  ReferenceEvaluationError on a malformed/unparseable response — never synthesizes
 *  a passing result. */
export function parseReferenceResponse(
  raw: string,
  preset: string,
  labelThreshold: number,
): { score: number; label: CalibrationLabel; rationale: string } {
  const criteria = resolveCriterionPreset(preset);
  const isMulti = criteria.length > 1;
  const cleaned = stripCodeFence(raw);

  try {
    if (isMulti) {
      const parsed = EvaluationResultSchema.parse(JSON.parse(cleaned));
      const score = calculateWeightedScore(parsed.criteriaScores, criteria);
      const rationale = criteria
        .map((c) => `${c.name}: ${parsed.criteriaScores[c.name]?.reasoning ?? "(no reasoning)"}`)
        .join(" | ");
      return { score, label: deriveCalibrationLabel(score, labelThreshold), rationale };
    }
    const parsed = JudgeResponseSchema.parse(JSON.parse(cleaned));
    return {
      score: parsed.score,
      label: deriveCalibrationLabel(parsed.score, labelThreshold),
      rationale: parsed.reasoning,
    };
  } catch (error) {
    throw new ReferenceEvaluationError(`failed to parse reference response: ${(error as Error).message}`);
  }
}

/** Scores one calibration item via a live call to `referenceProvider`/`referenceModel`,
 *  using the same rubric prompt and scoring semantics as the target judge — never the
 *  target's own score or label. Throws on a malformed/unparseable response rather than
 *  synthesizing a passing result. */
export async function evaluateReference(
  input: IReferenceEvaluationInput,
): Promise<IReferenceEvaluationResult> {
  const { prompt, jsonSchema } = buildReferencePrompt(
    input.requestContext,
    input.artifact,
    input.preset,
  );
  const env = {
    EXA_EVAL_LLM_MOCK: "false",
    EXA_LLM_PROVIDER: input.referenceProvider,
    EXA_LLM_MODEL: input.referenceModel,
  };

  let resolved: ILlmEndpointResolvedMetadata | undefined;
  let raw: string;
  try {
    raw = await callLlmEndpoint(prompt, env, jsonSchema, (metadata: ILlmEndpointResolvedMetadata): void => {
      resolved = metadata;
    }, input.judgeBinding);
  } catch (error) {
    throw new ReferenceEvaluationError(`reference call failed: ${(error as Error).message}`);
  }
  if (!resolved) {
    throw new ReferenceEvaluationError(`reference call resolved to no provider/model for "${input.referenceProvider}"`);
  }
  if (resolved.provider !== input.referenceProvider) {
    throw new ReferenceEvaluationError(
      `reference provider substituted: requested "${input.referenceProvider}", resolved "${resolved.provider}"`,
    );
  }

  const { score, label, rationale } = parseReferenceResponse(
    raw,
    input.preset,
    input.labelThreshold,
  );
  return { score, label, rationale, provider: resolved.provider, model: resolved.model };
}

/** The isolated (bwrap-sandboxed) counterpart to LocalCalibrationReferenceAdapter.
 *  It keeps the same prompt and scoring semantics. The live call runs inside the
 *  empty-root allowlisted profile. `CalibrationRunner` cannot tell the adapters apart. */
export class SandboxedCalibrationReferenceAdapter implements ICalibrationReferenceAdapter {
  constructor(private readonly scratchRoot: string) {}

  async score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult> {
    const { prompt } = buildReferencePrompt(item.snapshot.request_context, item.snapshot.artifact, rubric.preset);
    const cli = resolveSandboxCli(target.provider);

    const result = await runSandboxedCliCall({
      cli,
      model: stripProviderPrefix(target.model),
      prompt,
      scratchRoot: this.scratchRoot,
    });

    const { score } = parseReferenceResponse(result.stdout, rubric.preset, rubric.label_threshold);
    return { score, provider: target.provider, model: target.model };
  }
}
