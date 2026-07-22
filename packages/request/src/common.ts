/**
 * @module RequestCommon
 * @path packages/request/src/common.ts
 * @description Provides common utility functions for loading agent blueprints
 * and building parsed request objects.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/execution/src/agent_runner.ts", "packages/schemas/src/request_analysis.ts"]
 */
import { join } from "@std/path";
import { exists } from "@std/fs";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import type { IRequestFrontmatter } from "@exaix/core/request";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";

/** Load an agent blueprint file from a blueprints directory. */
export async function loadBlueprint(blueprintsPath: string, identityId: string): Promise<IBlueprint | null> {
  const blueprintPath = join(blueprintsPath, `${identityId}.md`);
  if (!await exists(blueprintPath)) return null;
  try {
    const content = await Deno.readTextFile(blueprintPath);
    return { systemPrompt: content, identityId };
  } catch (err) {
    console.error(`Failed to load blueprint ${identityId}:`, err);
    return null;
  }
}

/** Build a IParsedRequest used by IAgentRunner. */
export function buildParsedRequest(
  body: string,
  frontmatter: IRequestFrontmatter,
  requestId: string,
  traceId: string,
): IParsedRequest {
  let skills: string[] | undefined;
  if (frontmatter.skills) {
    const s = frontmatter.skills.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          skills = parsed.map((x) => String(x).trim()).filter((x) => x.length > 0);
        }
      } catch {
        // Fallback to split if parsing fails
      }
    }

    if (!skills) {
      skills = s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
    }
  }

  return {
    userPrompt: body.trim(),
    context: {
      priority: frontmatter.priority,
      source: frontmatter.source,
      traceId,
      requestId,
      ...(frontmatter.acceptance_criteria !== undefined && {
        acceptance_criteria: frontmatter.acceptance_criteria,
      }),
      ...(frontmatter.expected_outcomes !== undefined && {
        expected_outcomes: frontmatter.expected_outcomes,
      }),
      ...(frontmatter.scope !== undefined && { scope: frontmatter.scope }),
    },
    requestId,
    traceId,
    skills,
    model: frontmatter.model,
    model_size: frontmatter.model_size,
    preferred_provider: frontmatter.preferred_provider,
    thinking: frontmatter.thinking,
    effort: frontmatter.effort,
    characteristics: frontmatter.characteristics,
  };
}

/**
 * Build the retry prompt sent back to the model after a plan-generation response fails
 * JSON validation. The original task is repeated verbatim (a prior version fully replaced
 * `userPrompt` with the correction request, leaving the model with no visibility into the
 * actual task on retry) and the rejected output is explicitly labeled as the model's own
 * previous attempt — never reusing the generic "YOUR TASK" wrapper `constructPrompt` applies
 * to `userPrompt`, since that framing caused the model to treat its own invalid prior output
 * as a fresh human instruction and hallucinate an ongoing multi-turn conversation.
 */
export function buildPlanValidationFeedbackPrompt(
  originalTask: string,
  validationError: string,
  invalidContent: string,
): string {
  return `${originalTask}

---
A note on your immediately preceding response to this same task (NOT a new instruction —
this is feedback on what YOU just generated above): it failed schema validation with the
error "${validationError}". The <content> section must be valid JSON.

Your rejected previous response, for reference only:
${invalidContent}

Re-attempt the task above now, returning a single valid JSON object in <content> that
strictly follows the schema.`;
}

/**
 * Enrich an IParsedRequest with structured analysis output.
 * Populates `taskType`, `tags`, and `filePaths` from the analysis so downstream
 * services (e.g. skill matching) can use structured intent data.
 */
export function applyAnalysisToRequest(
  request: IParsedRequest,
  analysis: IRequestAnalysis,
): void {
  request.taskType = analysis.taskType;
  request.tags = analysis.tags;
  request.filePaths = analysis.referencedFiles;
  request.context.analysis = analysis;
}
