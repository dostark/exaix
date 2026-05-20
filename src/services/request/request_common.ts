/**
 * @module RequestCommon
 * @path src/services/request/request_common.ts
 * @description Provides common utility functions for loading agent blueprints
 * and building parsed request objects.
 * @architectural-layer Services
 * @related-files ["src/services/request/request_processor.ts", "packages/execution/src/agent_runner.ts", "packages/schemas/src/request_analysis.ts"]
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

/** Build a IParsedRequest used by AgentRunner. */
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
  };
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
