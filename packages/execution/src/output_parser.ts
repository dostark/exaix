/**
 * @module OutputParser
 * @path packages/execution/src/output_parser.ts
 * @description Parses LLM responses, validates changeset results, and
 *   logs generation metrics. Extracted from AgentExecutor.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_executor.ts]
 */

import type { JSONValue } from "@exaix/core";
import { GIT_EMPTY_SHA } from "@exaix/git";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_executor.ts";
import { ChangesetResultSchema } from "@exaix/schemas/agent_executor.ts";

/** Fields from IExecutionContext used by OutputParser. */
export type IOutputParserContext = Pick<IExecutionContext, "trace_id" | "request_id" | "plan">;

/**
 * Parses LLM responses, validates changeset results, and logs generation metrics.
 * All methods are pure functions with no side effects.
 */
export class OutputParser {
  /**
   * Parse agent response to extract changeset result.
   * Extracts JSON from markdown code blocks or bare JSON.
   */
  parseAgentResponse(
    response: string,
    context: IOutputParserContext,
    startTime: number,
  ): IChangesetResult {
    const jsonMatch = response.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/) ||
      response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return this.defaultResult(context, startTime);
    }

    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      if (!parsed.branch) {
        parsed.branch = `feat/${context.request_id}-${context.trace_id.slice(0, 8)}`;
      }
      if (!parsed.commit_sha) {
        parsed.commit_sha = GIT_EMPTY_SHA;
      }
      if (!parsed.files_changed) {
        parsed.files_changed = [];
      }
      if (parsed.tool_calls === undefined) {
        parsed.tool_calls = 0;
      }
      if (!parsed.description) {
        parsed.description = context.plan;
      }
      if (!parsed.execution_time_ms) {
        parsed.execution_time_ms = Math.max(0, Date.now() - startTime);
      }

      return parsed as IChangesetResult;
    } catch {
      return this.defaultResult(context, startTime);
    }
  }

  /**
   * Validate changeset result against the schema.
   */
  validateReviewResult(result: JSONValue): IChangesetResult {
    return ChangesetResultSchema.parse(result);
  }

  private defaultResult(
    context: IOutputParserContext,
    startTime: number,
  ): IChangesetResult {
    return {
      branch: `feat/${context.request_id}-${context.trace_id.slice(0, 8)}`,
      commit_sha: GIT_EMPTY_SHA,
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Math.max(0, Date.now() - startTime),
    };
  }
}
