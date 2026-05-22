/**
 * @module DefineFlow
 * @path packages/core/src/func/define_flow.ts
 * @description Helper utility to construct Flow objects with sensible defaults and schema validation.
 */

import { FlowSchema, type IFlow } from "@exaix/schemas/flow.ts";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { JSONValue } from "@exaix/core";

export function defineFlow(config: {
  id: string;
  name: string;
  description: string;
  version?: string;
  steps: Array<{
    id: string;
    name: string;
    identity: string;
    dependsOn?: string[];
    input?: {
      source?: FlowInputSource;
      stepId?: string;
      from?: string[];
      transform?: string;
      transformArgs?: JSONValue;
    };
    condition?: string;
    timeout?: number;
    retry?: {
      maxAttempts?: number;
      backoffMs?: number;
    };
    skills?: string[];
  }>;
  output: { from: string | string[]; format?: FlowOutputFormat };
  settings?: { maxParallelism?: number; failFast?: boolean; timeout?: number; includeRequestCriteria?: boolean };
  defaultSkills?: string[];
}): IFlow {
  if (!config.id || config.id.trim() === "") throw new Error("Flow ID cannot be empty");
  if (!config.name || config.name.trim() === "") throw new Error("Flow name cannot be empty");
  if (!config.description || config.description.trim() === "") throw new Error("Flow description cannot be empty");
  if (!config.steps || config.steps.length === 0) throw new Error("Flow must have at least one step");

  for (const s of config.steps) {
    if (!s.id || s.id.trim() === "") throw new Error("Step ID cannot be empty");
    if (!s.name || s.name.trim() === "") throw new Error("Step name cannot be empty");
  }

  const flow: IFlow = {
    id: config.id,
    name: config.name,
    description: config.description,
    version: config.version ?? "1.0.0",
    steps: config.steps.map((step) => ({
      id: step.id,
      name: step.name,
      type: FlowStepType.AGENT,
      identity: step.identity,
      execution_mode: FlowStepExecutionMode.DECLARED,
      dependsOn: step.dependsOn ?? [],
      input: {
        source: (step.input?.source as FlowInputSource) ?? FlowInputSource.REQUEST,
        stepId: step.input?.stepId,
        from: step.input?.from,
        transform: step.input?.transform ?? "passthrough",
        transformArgs: step.input?.transformArgs as JSONValue | undefined,
      },
      condition: step.condition,
      timeout: step.timeout,
      retry: {
        maxAttempts: step.retry?.maxAttempts ?? 1,
        backoffMs: step.retry?.backoffMs ?? 1000,
      },
    })),
    output: {
      from: config.output.from,
      format: (config.output.format as FlowOutputFormat) ?? FlowOutputFormat.MARKDOWN,
    },
    settings: {
      maxParallelism: config.settings?.maxParallelism ?? 3,
      failFast: config.settings?.failFast ?? true,
      timeout: config.settings?.timeout,
      includeRequestCriteria: config.settings?.includeRequestCriteria ?? false,
    },
  };

  const parsed = FlowSchema.parse(flow);
  return parsed;
}
