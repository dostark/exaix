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
import type { Opt, Reason } from "@exaix/core/types";

/** Load an agent blueprint file from a blueprints directory. */
export async function loadBlueprint(blueprintsPath: string, agentRole: string): Promise<IBlueprint | null> {
  const blueprintPath = join(blueprintsPath, `${agentRole}.md`);
  if (!await exists(blueprintPath)) return null;
  try {
    const content = await Deno.readTextFile(blueprintPath);
    return { systemPrompt: content, agentRole: agentRole };
  } catch (err) {
    console.error(`Failed to load blueprint ${agentRole}:`, err);
    return null;
  }
}

/** Normalises a list-shaped frontmatter field (`skills`, `tags`): a YAML array, a
 *  JSON-encoded array string, or a comma-separated/single-value string all reach here. */
export function normalizeFrontmatterList(raw?: Opt<string[] | string, Reason.OptionalInput>): string[] | undefined {
  if (raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    const fromArray = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return fromArray.length > 0 ? fromArray : undefined;
  }

  const text = raw.trim();
  if (text.length === 0) return undefined;

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const fromJson = parsed.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
        if (fromJson.length > 0) return fromJson;
      }
    } catch {
      // Malformed JSON — fall through to the comma-separated reading below.
    }
  }

  const fromCsv = text.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return fromCsv.length > 0 ? fromCsv : undefined;
}

/** Builds the IParsedRequest used by IAgentRunner. */
export function buildParsedRequest(
  body: string,
  frontmatter: IRequestFrontmatter,
  requestId: string,
  traceId: string,
): IParsedRequest {
  const skills = normalizeFrontmatterList(frontmatter.skills);

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
    tags: normalizeFrontmatterList(frontmatter.tags),
    model: frontmatter.model,
    model_size: frontmatter.model_size,
    preferred_provider: frontmatter.preferred_provider,
    thinking: frontmatter.thinking,
    effort: frontmatter.effort,
    characteristics: frontmatter.characteristics,
    scenarioId: frontmatter.scenario_id,
    stepId: frontmatter.step_id,
  };
}

/** The original task is repeated verbatim and the rejected output is explicitly labeled
 *  as the model's own previous attempt — never reusing constructPrompt's generic "YOUR
 *  TASK" wrapper, which caused the model to hallucinate an ongoing multi-turn conversation. */
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

/** Populates `taskType`, `tags`, and `filePaths` on the request from structured analysis
 *  output, so downstream services (e.g. skill matching) get structured intent data. */
export function applyAnalysisToRequest(
  request: IParsedRequest,
  analysis: IRequestAnalysis,
): void {
  request.taskType = analysis.taskType;
  // Union, not overwrite: the skill matcher scores against the frontmatter tags, so
  // overwriting them would break tag-driven skill selection for every analyzed request.
  request.tags = [...new Set([...(request.tags ?? []), ...(analysis.tags ?? [])])];
  request.filePaths = analysis.referencedFiles;
  request.context.analysis = analysis;
}
