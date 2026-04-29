/**
 * @module LlmQualityAssessor
 * @path src/services/quality_gate/llm_assessor.ts
 * @description LLM-based quality assessor for incoming request bodies.
 * Sends the request text to an LLM with a structured assessment prompt, then
 * validates the response against RequestQualityAssessmentSchema. Falls back to
 * the heuristic assessor when the LLM fails or returns an invalid response.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/heuristic_assessor.ts, src/services/quality_gate/request_quality_gate.ts]
 */

import type { IModelProvider } from "../../ai/types.ts";
import type { IOutputValidator } from "../tool/output_validator.ts";
import {
  type IRequestQualityAssessment,
  RequestQualityAssessmentSchema,
} from "@exaix/schemas/request_quality_assessment.ts";
import { QualityGateMode } from "@exaix/core";
import { assessHeuristic } from "./heuristic_assessor.ts";

// Schema for the LLM response — excludes `metadata` which is injected by the
// assessor itself after the LLM call returns.
const LlmAssessmentResponseSchema = RequestQualityAssessmentSchema.omit({ metadata: true });

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const ASSESSMENT_PROMPT_TEMPLATE =
  `You are a technical product manager assessing whether an AI agent task request is specific enough to act on.

## Request to Assess

{requestText}

## Your Task

Analyze the request and return a JSON object with the following structure:
{
  "score": <integer 0-100 — overall quality score>,
  "level": "one of: excellent, good, acceptable, poor, unactionable",
  "issues": [
    {
      "type": "one of: vague, ambiguous, missing_context, conflicting, too_broad, no_acceptance_criteria",
      "description": "<specific description of this issue>",
      "severity": "one of: blocker, major, minor",
      "suggestion": "<actionable suggestion to fix this issue>"
    }
  ],
  "recommendation": "one of: proceed, auto-enrich, needs-clarification, reject",
  "enrichedBody": "<optional: improved version of the request body, only if significant improvement is possible>"
}

## Scoring Guidance

- 85-100 (excellent): Specific, actionable, has acceptance criteria, well-structured
- 70-84 (good): Clear intent, some specifics, minor gaps
- 50-69 (acceptable): Workable with some inference, limited specifics
- 20-49 (poor): Vague, multiple gaps, needs enrichment or clarification
- 0-19 (unactionable): Too vague to process meaningfully

Return ONLY the JSON object. No explanation, no markdown, no additional text.`;

// ---------------------------------------------------------------------------
// LlmQualityAssessor class
// ---------------------------------------------------------------------------

/**
 * Quality assessor that uses an LLM to produce a detailed quality assessment.
 * Intended for "llm" and "hybrid" QualityGateMode.
 */
export class LlmQualityAssessor {
  private readonly provider: IModelProvider;
  private readonly validator: IOutputValidator;

  constructor(provider: IModelProvider, validator: IOutputValidator) {
    this.provider = provider;
    this.validator = validator;
  }

  /**
   * Assess the quality of the given request text using an LLM.
   * Falls back to the heuristic assessor when the LLM fails or
   * returns a response that cannot be validated.
   *
   * @param requestText - Raw request body text to assess.
   * @returns A complete `IRequestQualityAssessment`.
   */
  async assess(requestText: string): Promise<IRequestQualityAssessment> {
    const start = performance.now();

    try {
      const prompt = ASSESSMENT_PROMPT_TEMPLATE.replace("{requestText}", requestText);
      const result = await this.provider.generate(prompt);
      const raw = result.content;
      const validation = this.validator.validate(raw, LlmAssessmentResponseSchema);

      if (validation.success && validation.value) {
        const durationMs = Math.round(performance.now() - start);
        return {
          ...validation.value,
          metadata: {
            assessedAt: new Date().toISOString(),
            mode: QualityGateMode.LLM,
            durationMs,
          },
        };
      }

      // Validation failed — fall back to heuristic
      return this._fallback(requestText, start);
    } catch {
      // LLM call failed — fall back to heuristic
      return this._fallback(requestText, start);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _fallback(requestText: string, start: number): IRequestQualityAssessment {
    const heuristic = assessHeuristic(requestText);
    const durationMs = Math.round(performance.now() - start);
    return {
      ...heuristic,
      metadata: {
        ...heuristic.metadata,
        mode: QualityGateMode.LLM,
        durationMs,
      },
    };
  }
}
