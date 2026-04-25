/**
 * @module LlmAnalyzer
 * @path src/services/request_analysis/llm_analyzer.ts
 * @description LLM-powered request analysis strategy. Sends a structured prompt
 * to an `IModelProvider` and validates the JSON response against
 * `RequestAnalysisSchema` via `IOutputValidator`. Falls back to a minimal
 * safe `IRequestAnalysis` on any failure so callers never receive an exception.
 * @architectural-layer Services
 * * @related-files [src/services/request_analysis/request_analyzer.ts, src/services/request_analysis/mod.ts]
 */

import type { IModelProvider } from "../../ai/types.ts";
import type { IOutputValidator } from "../tool/output_validator.ts";
import {
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestAnalysisSchema,
  RequestTaskType,
} from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "../../shared/types/request.ts";
import type { IRequestAnalysisContext } from "../../shared/interfaces/i_request_analyzer_service.ts";
import { ANALYZER_VERSION } from "@exaix/core";

const RequestAnalysisCoreSchema = RequestAnalysisSchema.omit({ metadata: true });

// ---------------------------------------------------------------------------
// Analysis prompt template
// ---------------------------------------------------------------------------

const ANALYSIS_PROMPT_TEMPLATE = `You are a request intent analyzer for an AI orchestration system.
Analyze the following request and extract structured information.

REQUEST:
{REQUEST_TEXT}

{CONTEXT_SECTION}

Respond with ONLY a valid JSON object matching this exact structure (no markdown, no explanation):
{
  "goals": [{ "description": "string", "explicit": boolean, "priority": number (≥1) }],
  "requirements": [{ "description": "string", "confidence": number (0.0-1.0), "type": "functional|non-functional|constraint", "explicit": boolean }],
  "constraints": ["string"],
  "acceptanceCriteria": ["string"],
  "ambiguities": [{ "description": "string", "impact": "low|medium|high", "interpretations": ["string"], "clarificationQuestion": "string (optional, omit if unknown)" }],
  "actionabilityScore": number (0-100, higher = clearer/more actionable),
  "complexity": "simple, medium, complex, or epic",
  "taskType": "feature, bugfix, refactor, test, docs, analysis, or unknown",
  "tags": ["string"],
  "referencedFiles": ["string"]
}

Rules:
- goals: EVERY request has at least one goal. Be specific and distinct.
- do NOT return "meta-goals" like "analyze this request" or "extract goals". Analyze the CONTENT of the request, not your own instructions.
- requirements: concrete conditions the implementation must satisfy; confidence 0.0-1.0
- constraints: limitations or restrictions (e.g. "no new dependencies", "Node 18")
- complexity: simple (<2 bullets), epic (multi-phase), complex (>10 bullets), else medium
- taskType: primary signal (bug→bugfix, refactor→refactor, test→test, doc→docs, analyze→analysis, else feature)
- IF the request is actionable, you MUST provide at least one clear goal. Do not return empty lists for intent-filled requests.`;

const REVIEWER_PROMPT_TEMPLATE = `You are reviewing a request analysis for accuracy and common sense.
ORIGINAL REQUEST:
{REQUEST_TEXT}

EXTRACTED ANALYSIS:
{EXTRACTED_JSON}

Your task:
1. Check if the "goals" accurately reflect the intent.
2. If goals are missing or too generic (e.g. just "process request"), ADD the missing specific goals.
3. Ensure "actionabilityScore" is realistic.
4. Ensure ambiguous components specify "interpretations" and "clarificationQuestion" properly.
5. Output ONLY the refined JSON matching the original structure.

{CONTEXT_SECTION}`;

function buildContextSection(context?: IRequestAnalysisContext): string {
  let contextSection = "";
  if (context) {
    const parts: string[] = [];
    if (context.identityId) parts.push(`Agent: ${context.identityId}`);
    if (context.priority) parts.push(`Priority: ${context.priority}`);
    if (context.filePaths?.length) {
      const files = context.filePaths.slice(0, 25);
      const suffix = context.filePaths.length > 25 ? `... (${context.filePaths.length - 25} more)` : "";
      parts.push(`Known project files: ${files.join(", ")}${suffix}`);
    }
    if (context.tags?.length) parts.push(`Existing tags: ${context.tags.join(", ")}`);
    if (context.memories?.memoryContext) {
      parts.push(`\n${context.memories.memoryContext}`);
    }
    if (parts.length > 0) {
      contextSection = `\nCONTEXT/MEMORIES:\n${parts.join("\n")}\n`;
    }
  }
  return contextSection;
}

function buildPrompt(requestText: string, context?: IRequestAnalysisContext): string {
  const contextSection = buildContextSection(context);

  return ANALYSIS_PROMPT_TEMPLATE
    .replace("{REQUEST_TEXT}", requestText)
    .replace("{CONTEXT_SECTION}", contextSection);
}

// ---------------------------------------------------------------------------
// Fallback analysis returned whenever LLM output is invalid
// ---------------------------------------------------------------------------

function buildFallback(requestText: string): IRequestAnalysis {
  return {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 0,
    complexity: requestText.trim().length <= 200 ? RequestAnalysisComplexity.SIMPLE : RequestAnalysisComplexity.MEDIUM,
    taskType: RequestTaskType.UNKNOWN,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.LLM,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

// ---------------------------------------------------------------------------
// LlmAnalyzer class
// ---------------------------------------------------------------------------

/**
 * Produces a full `IRequestAnalysis` using an LLM provider.
 * Uses `IOutputValidator.validate()` with `RequestAnalysisSchema` to parse
 * the LLM's JSON response, and returns a safe fallback on any failure.
 */
export class LlmAnalyzer {
  constructor(
    private readonly provider: IModelProvider,
    private readonly validator: IOutputValidator,
  ) {}

  async analyze(
    requestText: string,
    context?: IRequestAnalysisContext,
  ): Promise<IRequestAnalysis> {
    const startMs = Date.now();
    const prompt = buildPrompt(requestText, context);

    let raw: string;
    try {
      const genResult = await this.provider.generate(prompt, { temperature: 0, max_tokens: 1500 });
      raw = genResult.content;
    } catch {
      const fallback = buildFallback(requestText);
      fallback.metadata.durationMs = Date.now() - startMs;
      return fallback;
    }

    let result = this.validator.parseAndValidate(raw, RequestAnalysisCoreSchema);

    // Refine Pass (Reviewer) for better common-sense alignment
    if (result.success && result.value) {
      const reviewPrompt = REVIEWER_PROMPT_TEMPLATE
        .replace("{REQUEST_TEXT}", requestText)
        .replace("{EXTRACTED_JSON}", JSON.stringify(result.value, null, 2))
        .replace("{CONTEXT_SECTION}", context ? buildContextSection(context) : "");

      try {
        const refinedResult2 = await this.provider.generate(reviewPrompt, { temperature: 0, max_tokens: 1500 });
        const refinedResult = this.validator.parseAndValidate(refinedResult2.content, RequestAnalysisCoreSchema);
        if (refinedResult.success && refinedResult.value) {
          result = refinedResult;
        }
      } catch (e) {
        console.warn(`[LlmAnalyzer] Refine pass failed: ${e}`);
      }
    }

    const durationMs = Date.now() - startMs;

    if (result.success && result.value) {
      return {
        ...result.value,
        metadata: {
          analyzedAt: new Date().toISOString(),
          durationMs,
          mode: AnalysisMode.LLM,
          analyzerVersion: ANALYZER_VERSION,
        },
      } as IRequestAnalysis;
    }

    if (!result.success) {
      console.warn(`[LlmAnalyzer] Validation failed for trace: ${context?.traceId || "unknown"}`);
      console.warn(`[LlmAnalyzer] Raw response: ${raw.substring(0, 150)}...`);
      console.warn(`[LlmAnalyzer] Errors: ${JSON.stringify(result.errors)}`);
    }

    const fallback = buildFallback(requestText);
    fallback.metadata.durationMs = durationMs;
    return fallback;
  }
}
