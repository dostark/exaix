/**
 * @module TaskComplexityClassifier
 * @path packages/request/src/task_complexity_classifier.ts
 * @description Classifies task complexity from structured analysis, content
 * heuristics, or agent-ID fallback. Extracted from RequestProcessor (god-object
 * decomposition, .copilot/skills/refactor/SKILL.md step d) since this logic is
 * a stateless, self-contained decision tree with no dependency on
 * RequestProcessor's other fields.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts"]
 */
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_PATTERN,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
  TaskComplexity,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";

export interface ITaskComplexityClassifier {
  classify(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): TaskComplexity;
}

export class TaskComplexityClassifier implements ITaskComplexityClassifier {
  classify(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): TaskComplexity {
    if (analysis?.complexity) {
      return this.mapAnalysisComplexity(analysis.complexity);
    }

    const bodySignals = this.checkContentHeuristics(request.userPrompt);
    if (bodySignals) return bodySignals;

    return this.classifyByAgentId(blueprint.identityId);
  }

  private mapAnalysisComplexity(complexity: RequestAnalysisComplexity): TaskComplexity {
    switch (complexity) {
      case RequestAnalysisComplexity.SIMPLE:
        return TaskComplexity.SIMPLE;
      case RequestAnalysisComplexity.MEDIUM:
        return TaskComplexity.MEDIUM;
      case RequestAnalysisComplexity.COMPLEX:
      case RequestAnalysisComplexity.EPIC:
        return TaskComplexity.COMPLEX;
      default:
        return TaskComplexity.MEDIUM;
    }
  }

  private checkContentHeuristics(
    body?: Opt<string, Reason.OptionalInput>,
  ): TaskComplexity | null {
    if (!body) return null;
    const fileRefs = body.match(COMPLEXITY_FILE_REF_PATTERN);
    if (fileRefs && fileRefs.length >= COMPLEXITY_FILE_REF_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    const bulletPoints = (body.match(/\n\s*[-*]\s+/g) || []).length;
    if (bulletPoints >= COMPLEXITY_BULLET_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    if (body.length < COMPLEXITY_BODY_LENGTH_LOW && !body.includes("\n-")) return TaskComplexity.SIMPLE;
    return null;
  }

  private classifyByAgentId(
    identityId?: Opt<string, Reason.OptionalContext>,
  ): TaskComplexity {
    const id = identityId || "";
    if (id.includes("analyzer") || id.includes("summarizer")) return TaskComplexity.SIMPLE;
    if (id.includes("coder") || id.includes("planner") || id.includes("architect")) {
      return TaskComplexity.COMPLEX;
    }
    return TaskComplexity.MEDIUM;
  }
}
