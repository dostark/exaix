/**
 * @module ReActLoopTypes
 * @path packages/execution/src/strategies/react_loop_types.ts
 * @description The action and history role types that the ReAct loop, its response parser and its history budget share.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/strategies/react_response_parser.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { INativeConversationSnapshot, IProviderTurn, IToolChoice, IToolDefinition } from "@exaix/ai/types.ts";
import type { NativeToolChoiceMode } from "./react_loop_strategy.ts";

export interface IReActAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

/**
 * Roles for the internal ReAct loop history.
 */
export enum ReActRole {
  THOUGHT = "thought",
  ACTION = "action",
  RESULT = "result",
}

/** Internal type for dynamically-built provider.generate() options. */
export interface IGeneratedOptions {
  traceId?: string;
  temperature: number;
  max_tokens: number;
  tools?: IToolDefinition[];
  toolChoice?: IToolChoice;
  priorTurn?: IProviderTurn;
  nativeConversation?: INativeConversationSnapshot;
  /** "forced" means the preferred-tool branch chose this iteration's tool choice. "any" means the
   *  unconstrained fallback. Non-wire: provider request builders ignore it. */
  nativeToolChoiceMode?: NativeToolChoiceMode;
}
