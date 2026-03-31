/**
 * @module JudgeEvaluator
 * @path src/flows/judge_evaluator.ts
 * @description Orchestrates judge agent invocation and result parsing for output quality evaluation, including JSON repair and heuristic recovery.
 * @architectural-layer Flows
 * * @related-files [src/flows/gate_evaluator.ts, src/flows/evaluation_criteria.ts]
 */

import { buildEvaluationPrompt, EvaluationCriterion, EvaluationResult } from "./evaluation_criteria.ts";
import { JudgeInvoker } from "./gate_evaluator.ts";

/**
 * Context object for agent requests
 */
export interface IAgentContext {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | IAgentContext
    | (string | number | boolean | null | undefined | IAgentContext)[]
    | string[];
}

/**
 * Parsed JSON object from evaluation response
 */
interface ParsedEvaluationJson {
  feedback?: string;
  summary?: string;
  suggestions?: string[];
  criteriaScores?: CriterionScoresMap;
  scores?: CriterionScoresMap;
  [key: string]: string | number | boolean | string[] | CriterionScoresMap | null | undefined;
}

/**
 * Map of criterion names to their scores
 */
interface CriterionScoresMap {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Interface for running agents
 */
export interface AgentRunner {
  run(
    identityId: string,
    request: { userPrompt: string; context?: IAgentContext },
  ): Promise<{ content: string }>;
}

/**
 * JudgeEvaluator - Wraps agent runner to implement JudgeInvoker
 *
 * Handles:
 * - Building evaluation prompts
 * - Invoking judge agents
 * - Parsing and validating JSON responses
 * - Recovering from malformed JSON
 */
export class JudgeEvaluator implements JudgeInvoker {
  constructor(private agentRunner: AgentRunner) {}

  /**
   * Evaluate content using a judge agent
   */
  async evaluate(
    identityId: string,
    content: string,
    criteria: EvaluationCriterion[],
    context?: string,
  ): Promise<EvaluationResult> {
    // Build evaluation prompt
    const prompt = buildEvaluationPrompt(content, criteria, context);

    // Invoke judge agent
    const response = await this.agentRunner.run(identityId, {
      userPrompt: prompt,
      context: {
        evaluationMode: true,
        expectedResponseFormat: "json",
        criteria: criteria.map((c) => c.name),
      },
    });

    // Parse and validate response
    return this.parseEvaluationResponse(response.content, criteria);
  }

  private calculateOverallScore(criteriaScores: EvaluationResult["criteriaScores"]): number {
    const scores = Object.values(criteriaScores);
    return scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : 0;
  }

  /**
   * Parse evaluation response from judge agent
   */
  private parseEvaluationResponse(
    response: string,
    criteria: EvaluationCriterion[],
  ): EvaluationResult {
    // Try to extract JSON from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // Fallback: extract scores using heuristics
      return this.parseHeuristicResponse(response, criteria);
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);
      return this.normalizeEvaluationResult(parsed, criteria);
    } catch (_e) {
      // Try to repair JSON
      const repaired = this.repairJson(jsonStr);
      if (repaired) {
        return this.normalizeEvaluationResult(repaired, criteria);
      }

      // Fallback to heuristic parsing
      return this.parseHeuristicResponse(response, criteria);
    }
  }

  /**
   * Normalize parsed JSON to EvaluationResult format
   */
  private normalizeEvaluationResult(
    parsed: ParsedEvaluationJson,
    criteria: EvaluationCriterion[],
  ): EvaluationResult {
    const criteriaScores: EvaluationResult["criteriaScores"] = {};

    for (const criterion of criteria) {
      criteriaScores[criterion.name] = this.extractCriterionScore(parsed, criterion);
    }

    // Calculate overall score
    const overallScore = this.calculateOverallScore(criteriaScores);

    return {
      overallScore,
      criteriaScores,
      pass: overallScore >= 0.7,
      feedback: String(parsed.feedback || parsed.summary || ""),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
      metadata: {
        evaluatedAt: new Date().toISOString(),
      },
    };
  }

  private extractCriterionScore(
    parsed: ParsedEvaluationJson,
    criterion: EvaluationCriterion,
  ): EvaluationResult["criteriaScores"][string] {
    const name = criterion.name;

    const fromCriteriaScores = this.extractCriterionFromCriteriaScores(parsed, name);
    if (fromCriteriaScores) return fromCriteriaScores;

    const fromScoresObject = this.extractCriterionFromScoresObject(parsed, name);
    if (fromScoresObject) return fromScoresObject;

    const fromTopLevel = this.extractCriterionFromTopLevel(parsed, name);
    if (fromTopLevel) return fromTopLevel;

    return {
      name,
      score: 0,
      reasoning: "Criterion not evaluated",
      issues: ["Criterion score not found in response"],
      passed: false,
    };
  }

  private extractCriterionFromCriteriaScores(
    parsed: ParsedEvaluationJson,
    name: string,
  ): EvaluationResult["criteriaScores"][string] | null {
    if (!parsed.criteriaScores || typeof parsed.criteriaScores !== "object") return null;

    const scores = parsed.criteriaScores as CriterionScoresMap;
    const raw = scores[name];
    if (!raw || typeof raw !== "object") return null;

    const scoreObj = raw as CriterionScoresMap;
    const score = this.normalizeScore(scoreObj.score);

    return {
      name,
      score,
      reasoning: String(scoreObj.reasoning || scoreObj.reason || ""),
      issues: Array.isArray(scoreObj.issues) ? scoreObj.issues.map(String) : [],
      passed: score >= 0.7,
    };
  }

  private extractCriterionFromScoresObject(
    parsed: ParsedEvaluationJson,
    name: string,
  ): EvaluationResult["criteriaScores"][string] | null {
    if (!parsed.scores || typeof parsed.scores !== "object") return null;

    const scores = parsed.scores as CriterionScoresMap;
    if (!(name in scores)) return null;

    const score = this.normalizeScore(scores[name]);
    return {
      name,
      score,
      reasoning: "",
      issues: [],
      passed: score >= 0.7,
    };
  }

  private extractCriterionFromTopLevel(
    parsed: ParsedEvaluationJson,
    name: string,
  ): EvaluationResult["criteriaScores"][string] | null {
    if (!(name in parsed)) return null;

    const value = parsed[name];
    if (typeof value === "object" && value !== null) {
      const obj = value as CriterionScoresMap;
      const score = this.normalizeScore(obj.score ?? obj.value ?? 0);
      return {
        name,
        score,
        reasoning: String(obj.reasoning || obj.reason || obj.feedback || ""),
        issues: Array.isArray(obj.issues) ? obj.issues.map(String) : [],
        passed: score >= 0.7,
      };
    }

    const score = this.normalizeScore(value);
    return {
      name,
      score,
      reasoning: "",
      issues: [],
      passed: score >= 0.7,
    };
  }

  /**
   * Normalize score to 0-1 range
   */
  private normalizeScore(value: unknown): number {
    if (typeof value === "number") {
      // Handle percentage (0-100) vs decimal (0-1)
      if (value > 1) {
        return Math.min(1, value / 100);
      }
      return Math.max(0, Math.min(1, value));
    }

    if (typeof value === "string") {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return this.normalizeScore(num);
      }
    }

    return 0;
  }

  /**
   * Try to repair malformed JSON
   */
  private repairJson(jsonStr: string): ParsedEvaluationJson | null {
    try {
      // Common fixes
      const repaired = jsonStr
        // Remove trailing commas
        .replace(/,\s*([\]}])/g, "$1")
        // Add missing quotes around keys
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
        // Replace single quotes with double quotes
        .replace(/'/g, '"');

      // Try parsing repaired JSON
      return JSON.parse(repaired) as ParsedEvaluationJson;
    } catch {
      return null;
    }
  }

  /**
   * Parse scores using heuristics when JSON parsing fails
   */
  private parseHeuristicResponse(
    response: string,
    criteria: EvaluationCriterion[],
  ): EvaluationResult {
    const criteriaScores: EvaluationResult["criteriaScores"] = {};

    for (const criterion of criteria) {
      const name = criterion.name;

      // Look for patterns like "CriterionName: 0.8" or "CriterionName - 80%"
      const patterns = [
        new RegExp(`${name}[:\\s-]+([\\d.]+)`, "i"),
        new RegExp(`${name}[:\\s-]+([\\d]+)%`, "i"),
        new RegExp(`${name.replace(/_/g, "\\s*")}[:\\s-]+([\\d.]+)`, "i"),
      ];

      let score = 0;
      let found = false;

      for (const pattern of patterns) {
        const match = response.match(pattern);
        if (match) {
          score = this.normalizeScore(match[1]);
          found = true;
          break;
        }
      }

      // Extract reasoning near the criterion name
      const reasoningMatch = response.match(
        new RegExp(`${name}[^.]*\\.\\s*([^.]+\\.)`, "i"),
      );

      criteriaScores[name] = {
        name,
        score,
        reasoning: reasoningMatch ? reasoningMatch[1].trim() : "",
        issues: found ? [] : ["Score extracted heuristically"],
        passed: score >= 0.7,
      };
    }

    const overallScore = this.calculateOverallScore(criteriaScores);

    return {
      overallScore,
      criteriaScores,
      pass: overallScore >= 0.7,
      feedback: "Evaluation extracted heuristically from response",
      suggestions: [],
      metadata: {
        evaluatedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Create a JudgeEvaluator from an agent runner
 */
export function createJudgeEvaluator(agentRunner: AgentRunner): JudgeEvaluator {
  return new JudgeEvaluator(agentRunner);
}
