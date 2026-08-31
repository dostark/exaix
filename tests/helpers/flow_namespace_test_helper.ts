/**
 * @module FlowNamespaceTestHelper
 * @path tests/helpers/flow_namespace_test_helper.ts
 * @description Shared executor and logger helpers for flow namespace tests.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";
import type { IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, FlowInputSource } from "@exaix/core";

/** Steps shared by the parallel-group integration flows: a start step fanned out to two writer steps in the "writers" parallel group. */
export function makeStartAndWritersSteps(): IFlowInput["steps"] {
  return [
    {
      id: "start",
      name: "Start",
      identity: "starter",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    },
    {
      id: "draft-a",
      name: "Draft A",
      identity: "writerA",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      parallel: { group: "writers" },
    },
    {
      id: "draft-b",
      name: "Draft B",
      identity: "writerB",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      parallel: { group: "writers" },
    },
  ];
}

export type ScriptedExecutorResponse =
  | IAgentExecutionResult
  | Error
  | string
  | ((
    request: IFlowStepRequest,
  ) => IAgentExecutionResult | Error | Promise<IAgentExecutionResult | Error | string> | string);

export class RecordingFlowLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

export class ScriptedAgentExecutor implements IAgentExecutor {
  readonly calls: string[] = [];
  readonly capturedRequests: Array<{ identityId: string; request: IFlowStepRequest }> = [];
  private readonly scripts = new Map<string, ScriptedExecutorResponse[]>();

  constructor(scripts: Record<string, ScriptedExecutorResponse[]>) {
    for (const [identityId, entries] of Object.entries(scripts)) {
      this.scripts.set(identityId, [...entries]);
    }
  }

  async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(identityId);
    this.capturedRequests.push({ identityId, request });

    const queue = this.scripts.get(identityId);
    if (!queue || queue.length === 0) {
      throw new Error(`No scripted response configured for ${identityId}`);
    }

    const next = queue.shift()!;
    const resolved = typeof next === "function" ? await next(request) : next;

    if (resolved instanceof Error) {
      throw resolved;
    }

    if (typeof resolved === "string") {
      return {
        thought: `processed ${identityId}`,
        content: resolved,
        raw: resolved,
      };
    }

    return resolved;
  }
}
