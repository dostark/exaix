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
import { taskComplexityFromAnalysis, type TaskComplexitySource } from "@exaix/ai";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";

export interface ITaskComplexityClassifier {
  classify(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): TaskComplexity;
  /** classify plus the source signal that decided the value — journaled so an
   *  LLM-derived complexity is distinguishable from a content/agent-id fallback. */
  classifyWithSource(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): { complexity: TaskComplexity; source: TaskComplexitySource };
}

/** The agent-id fallback's journaled source label. */
const COMPLEXITY_SOURCE_AGENT_ROLE: TaskComplexitySource = "agent_role";

export class TaskComplexityClassifier implements ITaskComplexityClassifier {
  classify(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): TaskComplexity {
    return this.classifyWithSource(blueprint, request, analysis).complexity;
  }

  classifyWithSource(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): { complexity: TaskComplexity; source: TaskComplexitySource } {
    if (analysis?.complexity) {
      return { complexity: taskComplexityFromAnalysis(analysis.complexity), source: "analysis" };
    }

    const bodySignals = this.checkContentHeuristics(request.userPrompt);
    if (bodySignals) return { complexity: bodySignals, source: "content_heuristic" };

    return { complexity: this.classifyByAgentId(blueprint.agentRole), source: COMPLEXITY_SOURCE_AGENT_ROLE };
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
    agentRole?: Opt<string, Reason.OptionalContext>,
  ): TaskComplexity {
    const id = agentRole || "";
    if (id.includes("analyzer") || id.includes("summarizer")) return TaskComplexity.SIMPLE;
    if (id.includes("coder") || id.includes("planner") || id.includes("architect")) {
      return TaskComplexity.COMPLEX;
    }
    return TaskComplexity.MEDIUM;
  }
}
