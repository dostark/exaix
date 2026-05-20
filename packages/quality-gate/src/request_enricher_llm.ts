/**
 * @module RequestEnricherLlm
 * @path packages/quality-gate/src/request_enricher_llm.ts
 * @description LLM-based request enricher that rewrites underspecified request
 * bodies to be more actionable while preserving the original intent. When the
 * LLM call fails the original body is returned unchanged so the enrichment is
 * never a hard dependency.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/src/request_quality_gate.ts, packages/quality-gate/src/llm_assessor.ts]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IRequestQualityIssue } from "@exaix/schemas/request_quality_assessment.ts";

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const ENRICHMENT_PROMPT_TEMPLATE = `You are improving a task request to make it more actionable for an AI agent.

## Original Request

{body}

## Issues Found

{issues}

## Your Task

Rewrite the request body to be:

1. **Specific** — Include concrete requirements, not vague wishes
2. **Structured** — Use numbered lists or clear sections where appropriate
3. **Bounded** — Define what is in scope and what is not
4. **Testable** — Include acceptance criteria or expected outcomes
5. **Contextual** — Reference relevant files, APIs, or systems where known

## Rules

- Preserve the original intent exactly. Do not add requirements the user did not imply.
- Do not pad with unnecessary boilerplate.
- Do not add explanatory commentary — output ONLY the improved request body.

Respond with ONLY the improved request body text.`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function formatIssuesForPrompt(issues: IRequestQualityIssue[]): string {
  return issues
    .map(
      (issue, idx) =>
        `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.description}\n   Suggestion: ${issue.suggestion}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rewrite an underspecified request body using an LLM.
 * Falls back to the original body if the LLM call fails.
 *
 * @param provider - LLM provider to use for enrichment.
 * @param body - Original request body text.
 * @param issues - Quality issues that led to this enrichment being triggered.
 * @returns Enriched request body, or the original body on failure.
 */
export async function enrichRequest(
  provider: IModelProvider,
  body: string,
  issues: IRequestQualityIssue[],
): Promise<string> {
  try {
    const prompt = ENRICHMENT_PROMPT_TEMPLATE
      .replace("{body}", body)
      .replace("{issues}", formatIssuesForPrompt(issues));

    const result = await provider.generate(prompt);
    const trimmed = result.content.trim();
    return trimmed.length > 0 ? trimmed : body;
  } catch {
    return body;
  }
}
