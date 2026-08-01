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
/**
 * Normalise a list-shaped frontmatter field (`skills`, `tags`) into a string array.
 *
 * Three shapes reach us: a YAML array (`skills: [a, b]`) from a hand-authored request, a
 * JSON-encoded array from the CLI (`service.ts` writes it with JSON.stringify), and a bare
 * comma-separated or single-value string. `skills` used to be typed `string` and parsed with
 * `.trim()`, so the hand-authored form — the one every eval fixture uses — threw
 * `frontmatter.skills.trim is not a function`.
 */
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
  // Union rather than overwrite: the frontmatter tags are the author's explicit statement of
  // intent and are the only input the skill matcher scores against a skill's declared trigger
  // tags. Assigning analysis.tags over them meant tag-driven skill selection could never fire
  // for any request that went through analysis — which is every request.
  request.tags = [...new Set([...(request.tags ?? []), ...(analysis.tags ?? [])])];
  request.filePaths = analysis.referencedFiles;
  request.context.analysis = analysis;
}
