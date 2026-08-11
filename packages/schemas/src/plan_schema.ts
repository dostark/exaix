/**
 * @module SharedPlanSchema
 * @path packages/schemas/src/plan_schema.ts
 * @description Defines shared Zod validation schemas for structured plans.
 * @architectural-layer Shared
 * @related-files ["packages/request/src/processor.ts", packages/schemas/src/memory_bank.ts]
 */

import { z } from "zod";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_QUERY_LIMIT, JSONValueSchema, McpToolName } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";

import { RequestAnalysisSchema } from "./request_analysis.ts";
import { zodToJsonSchema } from "./json_schema_adapter.ts";

/**
 * Zod schema for plan frontmatter to ensure type safety during parsing.
 * Supports both strict execution loop needs and enriched CLI metadata needs.
 */
// YAML's parseYaml() converts ISO-formatted date strings to Date objects automatically.
// We coerce them back to ISO strings so validation doesn't fail with
// "Expected string, received date".
const DateOrStringSchema = z.union([z.string(), z.date()]).transform((v) => v instanceof Date ? v.toISOString() : v);

export const PlanFrontmatterSchema = z.object({
  trace_id: z.string().optional().default(() => crypto.randomUUID()),
  request_id: z.string().optional().default("unknown"),
  identity_id: z.string().optional(),
  status: z.nativeEnum(PlanStatus),
  created_at: DateOrStringSchema.optional().default(() => new Date().toISOString()),
  updated_at: DateOrStringSchema.optional(),
  portal: z.string().optional(),
  target_branch: z.string().optional(),
  priority: z.union([z.number(), z.string()]).optional(),
  timeout: z.string().optional(),
  // CLI specific / Enrichment fields
  input_tokens: z.union([z.string(), z.number()]).optional(),
  output_tokens: z.union([z.string(), z.number()]).optional(),
  total_tokens: z.union([z.string(), z.number()]).optional(),
  token_provider: z.string().optional(),
  token_model: z.string().optional(),
  token_cost_usd: z.union([z.string(), z.number()]).optional(),
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
  rejected_by: z.string().optional(),
  rejected_at: z.string().optional(),
  rejection_reason: z.string().optional(),
  reviewed_by: z.string().optional(),
  skills: z.array(z.string()).optional(),
  request_analysis: RequestAnalysisSchema.optional(),
  subject: z.string().optional(),
  // Amendment fields (Phase 66)
  amendment_id: z.string().uuid().optional(),
  amendment_proposed_at: z.string().optional(),
}).passthrough();

export type PlanFrontmatter = z.infer<typeof PlanFrontmatterSchema>;

// ============================================================================
// Plan Step Schema
// ============================================================================

/**
 * Zod schema for individual tool actions within a step
 */
export const PlanActionSchema = z.object({
  /** Tool name to invoke */
  tool: z.nativeEnum(McpToolName),

  /** Parameters for the tool invocation */
  params: z.record(z.string(), JSONValueSchema),

  /** Optional: Description of what this specific action does */
  description: z.string().optional(),
});

export type IPlanAction = z.infer<typeof PlanActionSchema>;

/**
 * Zod schema for individual plan steps
 */
export const PlanStepSchema = z.object({
  /** Step number (1-indexed, sequential) */
  step: z.number().int().positive(),

  /** Step title/summary (max 200 chars) */
  title: z.string().min(1).max(200),

  /** Detailed description of what this step does */
  description: z.string().min(1),

  /** Optional: Ordered list of tool actions to execute for this step */
  actions: z.array(PlanActionSchema).optional(),

  /** Optional: Tools required for this step (legacy/high-level list) */
  tools: z.array(z.nativeEnum(McpToolName)).optional(),

  /** Optional: Success criteria to validate step completion */
  successCriteria: z.array(z.string()).optional(),

  /** Optional: Dependencies on other steps (by step number) */
  dependencies: z.array(z.union([z.number().int().positive(), z.string().min(1)])).optional(),

  /** Optional: Rollback instructions if step fails */
  rollback: z.string().optional(),
});

export type IPlanStep = z.infer<typeof PlanStepSchema>;

// ============================================================================
// QA Coverage Schemas (Flexible)
// ============================================================================

const QACoverageStatusSchema = z.enum(["PASS", "FAIL"]);

const QACoverageCaseSchema = z.object({
  scenario: z.string(),
  setup: z.string(),
  steps: z.array(z.string()),
  expectedResult: z.string(),
  status: QACoverageStatusSchema,
  notes: z.string().optional(),
}).passthrough();

const QAE2ECaseSchema = z.object({
  journey: z.string(),
  scenario: z.string(),
  preconditions: z.string(),
  steps: z.array(z.string()),
  verificationPoints: z.array(z.string()),
  status: QACoverageStatusSchema,
}).passthrough();

// ============================================================================
// Plan Schema
// ============================================================================

/**
 * Zod schema for complete execution plans
 * Enhanced to support specialized agent outputs (analysis, security, QA, performance)
 */
export const PlanSchema = z.object({
  /**
   * Plan name. `title` is the canonical, industry-standard, LLM-native field (every blueprint
   * instructs it, and models emit it naturally). `subject` is accepted as a legacy alias and is
   * surfaced onto `title` by the transform below ONLY when `title` is absent. Both are fully
   * optional and NEITHER is required: a plan candidate may omit a name entirely, and the
   * plan-writer supplies the originating request's subject onto the plan downstream
   * (plan_writer.ts), independent of the candidate. (max 80 chars)
   */
  title: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(200).optional(),

  /** Overall plan description */
  description: z.string().min(1),

  /** Optional: Ordered list of execution steps (1-50 steps) */
  steps: z.array(PlanStepSchema).min(1).max(DEFAULT_QUERY_LIMIT).optional(),

  /** Optional: Estimated total duration */
  estimatedDuration: z.string().optional(),

  /** Optional: Risk assessment */
  risks: z.array(z.string()).optional(),

  // ============================================================================
  // Specialized Agent Fields (Optional)
  // ============================================================================

  /** Optional: Analysis results for code analysis agents */
  analysis: z.object({
    /** Total files analyzed */
    totalFiles: z.number().optional(),
    /** Lines of code */
    linesOfCode: z.number().optional(),
    /** Main programming language */
    mainLanguage: z.string().optional(),
    /** Framework or technology stack */
    framework: z.string().optional(),
    /** Directory structure overview */
    directoryStructure: z.string().optional(),
    /** Module summary */
    modules: z.array(z.object({
      name: z.string(),
      purpose: z.string(),
      exports: z.array(z.string()),
      dependencies: z.array(z.string()),
    })).optional(),
    /** Key components */
    components: z.array(z.object({
      name: z.string(),
      location: z.string(),
      purpose: z.string(),
      api: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      usedBy: z.array(z.string()).optional(),
    })).optional(),
    /** Identified patterns */
    patterns: z.array(z.object({
      pattern: z.string(),
      location: z.string(),
      usage: z.string(),
    })).optional(),
    /** Type definitions */
    types: z.string().optional(),
    /** Entry points */
    entryPoints: z.array(z.string()).optional(),
    /** Complexity metrics */
    metrics: z.array(z.object({
      metric: z.string(),
      value: z.string().or(z.number()),
      assessment: z.string(),
    })).optional(),
    /** Recommendations */
    recommendations: z.array(z.string()).optional(),
  }).passthrough().optional(),

  /** Optional: Security analysis results */
  security: z.object({
    /** Executive summary */
    executiveSummary: z.string().optional(),
    /** Critical findings */
    findings: z.array(z.object({
      title: z.string(),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
      location: z.string(),
      description: z.string(),
      impact: z.string(),
      remediation: z.string(),
      codeExample: z.string().optional(),
    })).optional(),
    /** Security recommendations */
    recommendations: z.array(z.string()).optional(),
    /** Compliance notes */
    compliance: z.array(z.string()).optional(),
  }).passthrough().optional(),

  /** Optional: QA/testing results */
  qa: z.object({
    /** Test summary */
    testSummary: z.array(z.object({
      category: z.string(),
      planned: z.number(),
      executed: z.number(),
      passed: z.number(),
      failed: z.number(),
    })).optional(),
    /** Test coverage analysis */
    coverage: z.object({
      unit: z.array(QACoverageCaseSchema).optional(),
      integration: z.array(QACoverageCaseSchema).optional(),
      e2e: z.array(z.union([QAE2ECaseSchema, QACoverageCaseSchema])).optional(),
    }).passthrough().optional(),
    /** Issues found */
    issues: z.array(z.object({
      title: z.string(),
      severity: z.enum(["Critical", "High", "Medium", "Low"]),
      component: z.string(),
      stepsToReproduce: z.array(z.string()),
      description: z.string().optional(),
    })).optional(),
  }).passthrough().optional(),

  /** Optional: Performance analysis results */
  performance: z.object({
    /** Executive summary */
    executiveSummary: z.string().optional(),
    /** Performance findings */
    findings: z.array(z.object({
      title: z.string(),
      impact: z.enum(["HIGH", "MEDIUM", "LOW"]),
      category: z.enum(["Algorithm", "Database", "Memory", "IO", "Concurrency"]),
      location: z.string(),
      currentBehavior: z.string(),
      expectedImprovement: z.string(),
      recommendation: z.string(),
      codeExample: z.string().optional(),
    })).optional(),
    /** Optimization priorities */
    priorities: z.array(z.string()).optional(),
    /** Scalability assessment */
    scalability: z.object({
      currentCapacity: z.string(),
      bottleneckPoints: z.array(z.string()),
      scalingStrategy: z.string(),
    }).optional(),
  }).passthrough().optional(),
}).passthrough().refine((data) => {
  // Either steps must be present, or at least one specialized field must be present
  const hasSteps = data.steps !== undefined;
  const hasSpecialized = data.analysis !== undefined ||
    data.security !== undefined ||
    data.qa !== undefined ||
    data.performance !== undefined;
  return hasSteps || hasSpecialized;
}, {
  message:
    "Plan must contain either 'steps' for execution plans or at least one specialized field (analysis, security, qa, performance) for analysis reports",
}).transform((data) => {
  // `title` is the plan candidate's own name (what agents emit, industry-standard); `subject` is
  // a legacy alias. BOTH are optional — neither is required, because the plan-writer supplies the
  // originating request's subject onto the plan downstream (plan_writer.ts), independent of what
  // the candidate carries. As a convenience, when only the legacy `subject` was supplied as the
  // name, surface it as `title` too so consumers that read the canonical name get a value —
  // WITHOUT clobbering the distinct `subject`. When both are absent, both stay undefined.
  return data.title === undefined && data.subject !== undefined ? { ...data, title: data.subject } : data;
});

export type Plan = z.infer<typeof PlanSchema>;

// ============================================================================
// Specialized Types
// ============================================================================

/**
 * Produce a JSON Schema object derived from PlanSchema for use with
 * CLI --json-schema flags (e.g. claude-code's --json-schema). Returns a
 * plain object, not cached, so a schema change at runtime is never stale.
 */
export function getPlanJsonSchema(): Record<string, JSONValue> {
  return zodToJsonSchema(PlanSchema);
}

/** Analysis results for code analysis agents */
export type PlanAnalysis = z.infer<typeof PlanSchema>["analysis"];

/** Security analysis results */
export type PlanSecurity = z.infer<typeof PlanSchema>["security"];

/** QA/testing results */
export type PlanQA = z.infer<typeof PlanSchema>["qa"];

/** Performance analysis results */
export type PlanPerformance = z.infer<typeof PlanSchema>["performance"];
