/**
 * @module ReActResponseParser
 * @path packages/execution/src/strategies/react_response_parser.ts
 * @description Parses one model reply of the ReAct loop into its thought, its validated actions and its completion flag.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/tests/agents/react_loop_parse_failure_test.ts]
 */

import { PlanActionSchema } from "@exaix/schemas/plan_schema.ts";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "@exaix/core";
import { REACT_STATUS_COMPLETE, REACT_THOUGHT_PREFIX } from "@exaix/core";
import type { IReActAction } from "./react_loop_types.ts";

interface IReActParse {
  thought?: string;
  actions: IReActAction[];
  isComplete: boolean;
  parseErrors: string[];
}

/** The text after THOUGHT: up to the first action block, the completion marker or the end. */
function thoughtOf(response: string): string | undefined {
  // The lookahead alternatives hold no literal spaces, so a fence on its own line still ends the thought.
  const pattern = `${REACT_THOUGHT_PREFIX}\\s*(.*?)(?=\`\`\`toml|${REACT_STATUS_COMPLETE}|$)`;
  const match = response.match(new RegExp(pattern, "s"));
  return match ? match[1].trim() : undefined;
}

/** Validates one raw action with PlanActionSchema, so a hostile action is journaled and never executed. */
function validatedAction(act: JSONValue, parseErrors: string[]): IReActAction | undefined {
  if (act === null || typeof act !== "object" || Array.isArray(act)) {
    parseErrors.push("ReAct action is not an object");
    return undefined;
  }
  const candidate = act as Record<string, JSONValue>;
  const validated = PlanActionSchema.safeParse({
    tool: candidate.tool,
    params: candidate.params ?? {},
    description: candidate.description,
  });
  if (!validated.success) {
    parseErrors.push(validated.error.issues.map((issue) => issue.message).join("; "));
    return undefined;
  }
  return validated.data;
}

/** The raw actions of one toml block, or an empty list when the block holds no actions array. */
function rawActionsOf(block: string): JSONValue[] {
  const root = parseToml(block.trim()) as JSONValue;
  if (root === null || typeof root !== "object" || Array.isArray(root)) return [];
  const actions = (root as Record<string, JSONValue>).actions;
  return Array.isArray(actions) ? actions : [];
}

/** Parses one model reply into its thought, its validated actions and its completion flag. */
export function parseReActResponse(response: string): IReActParse {
  const parseErrors: string[] = [];
  const actions: IReActAction[] = [];
  for (const match of response.matchAll(/```toml\s*([\s\S]*?)```/g)) {
    try {
      for (const act of rawActionsOf(match[1])) {
        const action = validatedAction(act, parseErrors);
        if (action) actions.push(action);
      }
    } catch (error) {
      // A dropped action block must be journaled, because that is how a fix disappears while the loop reports success.
      parseErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { thought: thoughtOf(response), actions, isComplete: response.includes(REACT_STATUS_COMPLETE), parseErrors };
}
