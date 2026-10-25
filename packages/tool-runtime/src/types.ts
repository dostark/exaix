/**
 * @module ToolRuntimeTypes
 * @path packages/tool-runtime/src/types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Shared types for @exaix/tool-runtime.
 */

import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export interface IActivityJournal {
  log(entry: Record<string, JSONValue>): Promise<void>;
}

export interface IToolAgentExecutor {
  run(
    blueprint: { systemPrompt: string; agentRole: string },
    request: { userPrompt: string; context: object; traceId?: string },
  ): Promise<{ content: string }>;
}

export interface IMiddlewarePipeline<T> {
  use(fn: (ctx: T, next: () => Promise<void>) => Promise<void>): void;
  execute(ctx: T, final: () => Promise<void>): Promise<void>;
}

export interface IPathSecurityOps {
  resolveWithinRoots(inputPath: string, allowedRoots: string[], rootDir: string): Promise<string>;
}

/** Caller-facing text for every path containment denial. It names no host path and no root. */
export const PATH_ACCESS_DENIED_MESSAGE = "Access denied: path is outside allowed roots";

export class PathAccessError extends Error {
  /** The physical path that failed containment. Use it only for operator diagnostics, never in a caller response. */
  readonly resolvedPath?: string;

  constructor(message: string, resolvedPath?: Opt<string, Reason.OptionalContext>) {
    super(message);
    this.name = "PathAccessError";
    this.resolvedPath = resolvedPath;
  }
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}
