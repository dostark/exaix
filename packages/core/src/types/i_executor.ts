/**
 * @module IExecutor
 * @path packages/core/src/types/i_executor.ts
 * @description Minimal executor interface for voting fan-out — runs a blueprint with a prompt and returns content + optional confidence.
 * @architectural-layer Core
 * @dependencies []
 * @related-files [exaix-team/packages/voting/src/voting_consensus_service.ts]
 */

import type { IBindingRunSnapshot } from "@exaix/schemas";
import type { Opt, Reason } from "./optional_marker.ts";

/** Original flow identity retained by every voter in a prepared fan-out. */
export interface IExecutorContext {
  traceId?: Opt<string, Reason.TraceAbsent>;
  requestId?: Opt<string, Reason.OptionalContext>;
  scenarioId?: Opt<string, Reason.OptionalContext>;
  stepId?: Opt<string, Reason.OptionalContext>;
  flowId?: Opt<string, Reason.OptionalContext>;
  flowStepId?: Opt<string, Reason.OptionalContext>;
  bindingSnapshot?: Opt<IBindingRunSnapshot, Reason.OptionalContext>;
}

export interface IExecutorResult {
  content: string;
  confidence?: number;
}

export interface IExecutor {
  run(
    blueprint: string,
    prompt: string,
    context?: Opt<IExecutorContext, Reason.OptionalContext>,
  ): Promise<IExecutorResult>;
}
