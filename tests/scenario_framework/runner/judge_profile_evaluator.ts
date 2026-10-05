/**
 * @module JudgeProfileEvaluator
 * @path tests/scenario_framework/runner/judge_profile_evaluator.ts
 * @description Evaluate selected plan profiles through the ordinary provider boundary and canonical response parser.
 * @architectural-layer Test
 * @dependencies @exaix/core/evaluation, @exaix/schemas
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/calibration_reference.ts]
 */

import {
  type EvaluationResult,
  type IResolvedJudgeProfile,
  JudgeProfileError,
  parseJudgeProfileResponse,
  renderJudgeProfilePrompt,
} from "@exaix/core/evaluation";
import { getJudgeProfileResponseJsonSchema } from "@exaix/schemas/evaluation_json_schema.ts";
import type { callLlmEndpoint, IEvaluateCriterionOptions, ILlmEndpointResolvedMetadata } from "./assertions.ts";
import { resolveSandboxCli, runSandboxedCliCall, stripProviderPrefix } from "./calibration_sandbox.ts";
import { readSelectedJudgeEvidence } from "./judge_profile_loader.ts";
import { CriterionKind, CriterionStatus, type ICriterionResult } from "../schema/step_schema.ts";
import { CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR } from "./capture_calibration_evidence_flag.ts";

export interface IIsolatedCliSubmission {
  readonly adapter: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
}

export interface IIsolatedCliResult {
  readonly stdout: string;
  readonly provider: string;
  readonly model: string;
}

/** The calibration-only isolated transport seam: a selected CLI profile call runs
 *  through this instead of the ordinary provider factory. */
export type JudgeIsolatedCliSubmit = (input: IIsolatedCliSubmission) => Promise<IIsolatedCliResult>;

export interface ISelectedJudgeInput {
  options: IEvaluateCriterionOptions;
  profile: IResolvedJudgeProfile;
  submit: typeof callLlmEndpoint;
}

/** The transport adapters the isolated launcher can execute. */
const ISOLATED_CLI_ADAPTERS: readonly string[] = ["claude-cli", "codex-cli"];

const DEFAULT_ISOLATED_SCRATCH_ROOT = "/tmp";

async function defaultIsolatedCliSubmit(input: IIsolatedCliSubmission): Promise<IIsolatedCliResult> {
  const cli = resolveSandboxCli(input.adapter);
  const result = await runSandboxedCliCall({
    cli,
    model: stripProviderPrefix(input.model),
    prompt: input.prompt,
    scratchRoot: Deno.env.get("TMPDIR") ?? DEFAULT_ISOLATED_SCRATCH_ROOT,
  });
  return { stdout: result.stdout, provider: input.provider, model: input.model };
}

/** Selected profile calls use trusted instructions only and never infer missing declared evidence. */
export async function evaluateSelectedProfileCriterion(input: ISelectedJudgeInput): Promise<ICriterionResult> {
  const { options, profile, submit } = input;
  const base = {
    criterion_id: options.criterion.id,
    kind: CriterionKind.LLM_JUDGE,
    phase: options.phase,
    evidence_refs: [],
    score_weight: options.criterion.score_weight,
  };
  try {
    const criterion = options.criterion;
    if (
      criterion.kind !== CriterionKind.LLM_JUDGE || criterion.preset !== profile.spec.preset ||
      criterion.evidence_diff_dir || criterion.evidence_diff_path || criterion.test_run_source ||
      criterion.score_threshold !== profile.spec.label_threshold
    ) {
      throw new JudgeProfileError("judge-profile-incompatible-criterion");
    }
    const request: string = criterion.context_path
      ? await readSelectedJudgeEvidence(options.workspaceRoot, criterion.context_path)
      : criterion.rubric ?? "";
    const artifact: string = criterion.evidence_path
      ? await readSelectedJudgeEvidence(options.workspaceRoot, criterion.evidence_path)
      : options.executionResult?.stdout ?? "";
    const schema = getJudgeProfileResponseJsonSchema(profile);
    const prompt: string = renderJudgeProfilePrompt(profile, request, artifact, schema);
    if (options.env?.[CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR] || Deno.env.get(CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR)) {
      throw new JudgeProfileError("judge-profile-frozen-capture-required");
    }
    const mock: string | undefined = options.env?.EXA_EVAL_LLM_MOCK ?? Deno.env.get("EXA_EVAL_LLM_MOCK");
    if (mock !== "false") {
      return { ...base, status: CriterionStatus.SKIPPED, message: "judge-profile-live-provider-required" };
    }
    const adapter: string | undefined = options.judgeBinding?.adapter ?? options.env?.EXA_EVAL_LLM_PROVIDER ??
      options.env?.EXA_LLM_PROVIDER ?? Deno.env.get("EXA_EVAL_LLM_PROVIDER") ?? Deno.env.get("EXA_LLM_PROVIDER");
    let provider: string;
    let model: string;
    let raw: string;
    if (adapter === "mock") {
      let observed: ILlmEndpointResolvedMetadata | undefined;
      raw = await submit(prompt, options.env, schema, (metadata: ILlmEndpointResolvedMetadata): void => {
        observed = metadata;
      }, options.judgeBinding);
      if (!observed) throw new JudgeProfileError("judge-profile-missing-provider-identity");
      provider = observed.provider;
      model = observed.model;
    } else if (options.judgeBinding && adapter !== undefined && ISOLATED_CLI_ADAPTERS.includes(adapter)) {
      const isolated = options.judgeCliSubmit ?? defaultIsolatedCliSubmit;
      const isolatedResult: IIsolatedCliResult = await isolated({
        adapter,
        provider: options.judgeBinding.model_provider,
        model: options.judgeBinding.model,
        prompt,
      });
      raw = isolatedResult.stdout;
      provider = isolatedResult.provider;
      model = isolatedResult.model;
    } else {
      throw new JudgeProfileError("judge-profile-isolated-provider-required");
    }
    const result: EvaluationResult = parseJudgeProfileResponse(raw, profile);
    if (options.calibrationCapture) {
      await options.calibrationCapture({
        requestContext: request,
        artifact,
        rubricMethodology: profile.methodology,
        provider,
        model,
        promptUsed: prompt,
        rawResponse: raw,
      });
    }
    const rationale: string = profile.spec.criteria.map((entry): string =>
      `${entry.name}: ${result.criteriaScores[entry.name].reasoning}`
    ).join(" | ");
    return {
      ...base,
      status: result.pass ? CriterionStatus.PASSED : CriterionStatus.FAILED,
      score: result.overallScore,
      observed_value: result.overallScore,
      expected_value: profile.spec.label_threshold,
      message: `Selected judge profile ${profile.spec.id} (${profile.profileHash}): ${result.overallScore}`,
      judge: { provider, model, reasoning: rationale },
    };
  } catch (error) {
    return {
      ...base,
      status: CriterionStatus.ERROR,
      message: error instanceof JudgeProfileError ? error.message : "judge-profile-provider-failed",
    };
  }
}
