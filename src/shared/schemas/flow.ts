/**
 * @module FlowSchema
 * @path src/schemas/flow.ts
 * @description Defines Zod validation schemas for flow definitions, including steps, gates, feedback loops, and branch logic.
 * @architectural-layer Schemas
 * @dependencies [zod, enums]
 * @related-files [src/flows/flow_loader.ts, src/flows/condition_evaluator.ts]
 */

import { z } from "zod";
import {
  FlowConsensusMethod,
  FlowGateOnFail,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepType,
  McpToolName,
  StepExecutionMode,
} from "../enums.ts";
import { JSONValueSchema } from "../types/json.ts";
import { DEFAULT_FLOW_VERSION } from "../constants.ts";

// Gate evaluation configuration schema
export const GateEvaluateSchema = z.object({
  /** Judge identity ID */
  identity: z.string(),
  /** Criteria to evaluate (names from built-in library or custom) */
  criteria: z.array(z.string()),
  /** Score threshold for passing (0.0 - 1.0) */
  threshold: z.number().min(0).max(1).default(0.8),
  /** Action on failure */
  onFail: z.nativeEnum(FlowGateOnFail).default(FlowGateOnFail.HALT),
  /** Max retries if onFail is "retry" */
  maxRetries: z.number().int().min(1).default(3),
  /** Include dynamic criteria generated from the request analysis */
  includeRequestCriteria: z.boolean().default(false),
});

// Feedback loop configuration schema
export const FeedbackLoopSchema = z.object({
  /** Maximum iterations */
  maxIterations: z.number().int().min(1).max(10).default(3),
  /** Target score to achieve */
  targetScore: z.number().min(0).max(1).default(0.9),
  /** Step ID to loop back to */
  backTo: z.string().optional(),
});

// Branch condition schema
export const BranchConditionSchema = z.object({
  /** Condition expression */
  condition: z.string(),
  /** Step ID to goto if condition matches */
  goto: z.string(),
});

// Consensus configuration schema
export const ConsensusConfigSchema = z.object({
  /** Consensus method */
  method: z.nativeEnum(FlowConsensusMethod).default(FlowConsensusMethod.JUDGE),
  /** Judge agent for "judge" method */
  judge: z.string().optional(),
  /** Weights for "weighted" method */
  weights: z.record(z.number()).optional(),
});

// FlowStep schema definition
export const FlowStepSchema = z.object({
  id: z.string().min(1, "Step ID cannot be empty"),
  name: z.string().min(1, "Step name cannot be empty"),
  /** Step type: standard agent step, gate, branch, or consensus. Defaults to "agent" */
  type: z.nativeEnum(FlowStepType).optional().default(FlowStepType.AGENT),
  /** Identity reference (required for agent type, optional for others) */
  identity: z.string().min(1, "Identity reference cannot be empty"),
  /** Execution mode: DECLARED (default) or DYNAMIC (ReAct-style tool selection) */
  execution_mode: z.nativeEnum(StepExecutionMode).optional().default(StepExecutionMode.DECLARED),
  /** For DYNAMIC mode: tools the model may select from at runtime (read-only tools only) */
  permitted_tools: z.array(z.nativeEnum(McpToolName)).optional(),
  dependsOn: z.array(z.string()).default([]),
  input: z.object({
    source: z.nativeEnum(FlowInputSource).default(FlowInputSource.REQUEST),
    stepId: z.string().optional(),
    from: z.array(z.string()).optional(), // For aggregate source
    transform: z.union([z.string(), z.function().args(z.string()).returns(z.string())]).default("passthrough"),
    // Arguments for transform functions — flat JSON-compatible values
    transformArgs: JSONValueSchema.optional(),
    feedbackStepId: z.string().optional(), // For feedback source
  }).default({}),
  /** Condition for step execution (JavaScript expression) */
  condition: z.string().optional(),
  timeout: z.number().positive().optional(),
  retry: z.object({
    maxAttempts: z.number().int().min(1).default(1),
    backoffMs: z.number().int().min(0).default(1000),
  }).default({}),
  /** Gate evaluation config (for type: "gate") */
  evaluate: GateEvaluateSchema.optional(),
  /** Feedback loop config */
  loop: FeedbackLoopSchema.optional(),
  /** Branch conditions (for type: "branch") */
  branches: z.array(BranchConditionSchema).optional(),
  /** Default branch if no condition matches */
  default: z.string().optional(),
  /** Consensus config (for type: "consensus") */
  consensus: ConsensusConfigSchema.optional(),
  /** Skills to apply for this step (Phase 17) */
  skills: z.array(z.string()).optional(),
});

// Flow schema definition
export const FlowSchema = z.object({
  id: z.string().min(1, "Flow ID cannot be empty"),
  name: z.string().min(1, "Flow name cannot be empty"),
  description: z.string().min(1, "Flow description cannot be empty"),
  version: z.string().default(DEFAULT_FLOW_VERSION),
  steps: z.array(FlowStepSchema).min(1, "Flow must have at least one step"),
  output: z.object({
    from: z.union([z.string(), z.array(z.string())]),
    format: z.nativeEnum(FlowOutputFormat).default(FlowOutputFormat.MARKDOWN),
  }),
  settings: z.object({
    maxParallelism: z.number().int().min(1).default(3),
    failFast: z.boolean().default(true),
    timeout: z.number().positive().optional(),
    /** Flow-wide default: include dynamic criteria from request analysis in all gate steps */
    includeRequestCriteria: z.boolean().default(false),
  }).default({}),
  /** Default skills to apply to all steps (Phase 17) */
  defaultSkills: z.array(z.string()).optional(),
});

// Type exports for use in other modules
/** FlowStep type after schema parsing (with defaults applied) */
export type IFlowStep = z.infer<typeof FlowStepSchema>;
/** FlowStep input type (before defaults are applied, fields with defaults are optional) */
export type IFlowStepInput = z.input<typeof FlowStepSchema>;
/** Flow type after schema parsing (with defaults applied) */
export type IFlow = z.infer<typeof FlowSchema>;
/** Flow input type (before defaults are applied) */
export type IFlowInput = z.input<typeof FlowSchema>;
export type IGateEvaluate = z.infer<typeof GateEvaluateSchema>;
export type IFeedbackLoopConfig = z.infer<typeof FeedbackLoopSchema>;
export type IBranchCondition = z.infer<typeof BranchConditionSchema>;
export type IConsensusConfig = z.infer<typeof ConsensusConfigSchema>;
