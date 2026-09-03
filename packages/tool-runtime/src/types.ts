/**
 * @module ToolRuntimeTypes
 * @path packages/tool-runtime/src/types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Shared types for @exaix/tool-runtime.
 */

import type { JSONValue } from "@exaix/core";

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

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}
