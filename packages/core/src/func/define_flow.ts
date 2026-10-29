/**
 * @module DefineFlow
 * @path packages/core/src/func/define_flow.ts
 * @related-files []
 * @architectural-layer Core
 * @description Helper utility to construct Flow objects with sensible defaults and schema validation.
 */

import { FlowSchema, type IFlow } from "@exaix/schemas/flow.ts";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { JSONValue } from "@exaix/core";

type IFlowDefinitionConfig = {
  id: string;
  name: string;
  description: string;
  version?: string;
  steps: Array<{
    id: string;
    name: string;
    agent_role: string;
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
};

export function defineFlow(config: IFlowDefinitionConfig): IFlow {
  validateFlowConfig(config);
  return FlowSchema.parse({
    id: config.id,
    name: config.name,
    description: config.description,
    version: config.version ?? "1.0.0",
    steps: config.steps.map(flowStepOf),
    output: flowOutputOf(config),
    settings: flowSettingsOf(config),
  });
}

/** Rejects an empty flow, step, or required flow field. */
function validateFlowConfig(config: IFlowDefinitionConfig): void {
  if (!config.id || config.id.trim() === "") throw new Error("Flow ID cannot be empty");
  if (!config.name || config.name.trim() === "") throw new Error("Flow name cannot be empty");
  if (!config.description || config.description.trim() === "") throw new Error("Flow description cannot be empty");
  if (!config.steps || config.steps.length === 0) throw new Error("Flow must have at least one step");
  for (const step of config.steps) {
    if (!step.id || step.id.trim() === "") throw new Error("Step ID cannot be empty");
    if (!step.name || step.name.trim() === "") throw new Error("Step name cannot be empty");
  }
}

/** One declared flow step with its engine defaults. */
function flowStepOf(step: IFlowDefinitionConfig["steps"][number]): IFlow["steps"][number] {
  return {
    id: step.id,
    name: step.name,
    type: FlowStepType.AGENT,
    agent_role: step.agent_role,
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
  };
}

/** The flow output declaration with its default format. */
function flowOutputOf(config: IFlowDefinitionConfig): IFlow["output"] {
  return {
    from: config.output.from,
    format: (config.output.format as FlowOutputFormat) ?? FlowOutputFormat.MARKDOWN,
  };
}

/** The flow settings with their defaults. */
function flowSettingsOf(config: IFlowDefinitionConfig): IFlow["settings"] {
  return {
    maxParallelism: config.settings?.maxParallelism ?? 3,
    failFast: config.settings?.failFast ?? true,
    timeout: config.settings?.timeout,
    includeRequestCriteria: config.settings?.includeRequestCriteria ?? false,
  };
}
