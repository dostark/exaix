/**
 * @module OutputValidator
 * @path src/services/tool/output_validator.ts
 * @description Ensures structured agent output conforms to specified schemas.
 *
 * Features:
 * - Multiple output schemas (Plan, Evaluation, Analysis, etc.)
 * - XML tag extraction (<thought>, <content>)
 * - JSON parsing with common error repair
 * - LLM-based repair for complex failures
 * - Validation metrics tracking
 *
 * @architectural-layer Services
 * @related-files ["src/services/agent/agent_runner.ts", "src/services/utils/json_repair.ts"]
 */

import { z, ZodError, type ZodType, type ZodTypeDef } from "zod";
import { PlanSchema, PlanStepSchema } from "@exaix/schemas/plan_schema.ts";
import { AnalysisFindingSeverity, AnalysisFindingType } from "@exaix/core";
import { repairJSON } from "../utils/json_repair.ts";
import { describeSchema } from "@exaix/schemas/schema_describer.ts";
import { JSONValueSchema } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";

/**
 * Supported output format types
 */
export type IOutputFormat =
  | "xml_tagged"
  | "json"
  | "json_in_content"
  | "plain"
  | "markdown";

export type IOutputSchemaName = keyof typeof OutputSchemas;

/**
 * Detailed validation error
 */
export interface IValidationError {
  path: string[];
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

export type IEvaluation = z.infer<typeof OutputSchemas.evaluation>;
export type IAnalysis = z.infer<typeof OutputSchemas.analysis>;
export type ISimpleResponse = z.infer<typeof OutputSchemas.simpleResponse>;
export type IToolCall = z.infer<typeof OutputSchemas.toolCall>;
export type IActionSequence = z.infer<typeof OutputSchemas.actionSequence>;

/**
 * Result of parsing XML-tagged output
 */
export interface IParsedXMLOutput {
  thought: string;
  content: string;
  raw: string;
}

/**
 * Result of structured output validation
 */
export interface IValidationResult<T> {
  success: boolean;
  value?: T;
  errors?: IValidationError[];
  repairAttempted: boolean;
  repairSucceeded: boolean;
  raw: string;
  parsed?: IParsedXMLOutput;
}

/**
 * Validation metrics for tracking
 */
export interface IValidationMetrics {
  totalAttempts: number;
  successfulValidations: number;
  repairAttempts: number;
  successfulRepairs: number;
  failuresByErrorType: Record<string, number>;
}

/**
 * Configuration for OutputValidator
 */
export interface IOutputValidatorConfig {
  /** Enable automatic JSON repair attempts */
  autoRepair?: boolean;

  /** Maximum repair attempts before giving up */
  maxRepairAttempts?: number;

  /** Function to call LLM for repair (optional) */
  llmRepairFn?: (content: string, schema: string, error: string) => Promise<string>;
}

/**
 * Interface for OutputValidator service
 */
export interface IOutputValidator {
  /**
   * Parse XML-tagged response (<thought>, <content>)
   */
  parseXMLTags(raw: string): IParsedXMLOutput;

  /**
   * Validate content against a Zod schema
   */
  validate<T>(
    content: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): IValidationResult<T>;

  /**
   * Validate content using a named schema from the registry
   */
  validateWithSchema<K extends IOutputSchemaName>(
    content: string,
    schemaName: K,
  ): IValidationResult<z.infer<(typeof OutputSchemas)[K]>>;

  /**
   * Parse XML tags and validate content against a schema
   */
  parseAndValidate<T>(
    raw: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): IValidationResult<T>;

  /**
   * Parse XML tags and validate using a named schema
   */
  parseAndValidateWithSchema<K extends IOutputSchemaName>(
    raw: string,
    schemaName: K,
  ): IValidationResult<z.infer<(typeof OutputSchemas)[K]>>;

  /**
   * Get current validation metrics
   */
  getMetrics(): IValidationMetrics;

  /**
   * Reset validation metrics
   */
  resetMetrics(): void;
}

/**
 * Registry of output schemas for different agent types
 */
export const OutputSchemas = {
  plan: PlanSchema,
  planStep: PlanStepSchema,

  /**
   * Evaluation result schema (for quality-judge and similar agents)
   */
  evaluation: z.object({
    score: z.number().min(0).max(10),
    verdict: z.enum(["pass", "fail", "needs_improvement"]),
    reasoning: z.string().min(1),
    suggestions: z.array(z.string()).optional(),
    criteria: z.record(z.object({
      score: z.number().min(0).max(10),
      feedback: z.string(),
    })).optional(),
  }),

  /**
   * Analysis result schema (for code analysis, review agents)
   */
  analysis: z.object({
    summary: z.string().min(1),
    findings: z.array(z.object({
      type: z.nativeEnum(AnalysisFindingType),
      severity: z.nativeEnum(AnalysisFindingSeverity).optional(),
      message: z.string(),
      location: z.string().optional(),
      fix: z.string().optional(),
    })),
    metrics: z.record(z.union([z.string(), z.number()])).optional(),
  }),

  /**
   * Simple response schema (basic structured output)
   */
  simpleResponse: z.object({
    answer: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    sources: z.array(z.string()).optional(),
  }),

  /**
   * Tool call schema (for agents that invoke tools)
   */
  toolCall: z.object({
    tool: z.string().min(1),
    arguments: z.record(JSONValueSchema), // Arguments can be complex JSON
    reasoning: z.string().optional(),
  }),

  /**
   * Multi-step action schema (for complex workflows)
   */
  actionSequence: z.object({
    actions: z.array(z.object({
      type: z.string(),
      target: z.string().optional(),
      params: z.record(JSONValueSchema).optional(),
      fallback: z.string().optional(),
    })).min(1),
    fallback: z.string().optional(),
  }),
} as const;

export type OutputSchemaName = keyof typeof OutputSchemas;

// ============================================================================
// Parsed Output Types
// ============================================================================

/**
 * Detailed validation error
 */
export type ValidationError = {
  path: string[];
  message: string;
  code: string;
  expected?: string;
  received?: string;
};

/**
 * OutputValidator provides structured output parsing and validation
 */
export class OutputValidator implements IOutputValidator {
  private config: Required<Omit<IOutputValidatorConfig, "llmRepairFn">> & {
    llmRepairFn?: IOutputValidatorConfig["llmRepairFn"];
  };

  private metrics: IValidationMetrics = {
    totalAttempts: 0,
    successfulValidations: 0,
    repairAttempts: 0,
    successfulRepairs: 0,
    failuresByErrorType: {},
  };

  constructor(config: IOutputValidatorConfig = {}) {
    this.config = {
      autoRepair: config.autoRepair ?? true,
      maxRepairAttempts: config.maxRepairAttempts ?? 3,
      llmRepairFn: config.llmRepairFn,
    };
  }

  // ==========================================================================
  // XML Tag Parsing
  // ==========================================================================

  /**
   * Parse XML-tagged response (<thought>, <content>)
   */
  parseXMLTags(raw: string): IParsedXMLOutput {
    if (raw == null) {
      return { thought: "", content: "", raw: "" };
    }

    const responseStr = String(raw);
    const thoughtRegex = /<thought>([\s\S]*?)<\/thought>/i;
    const contentRegex = /<content>([\s\S]*?)<\/content>/i;

    const thoughtMatch = responseStr.match(thoughtRegex);
    const contentMatch = responseStr.match(contentRegex);

    let thought = "";
    let content = "";

    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
    }

    if (contentMatch) {
      content = contentMatch[1].trim();
    }

    // Fallback: if no tags found, treat whole response as content
    if (!thoughtMatch && !contentMatch) {
      content = responseStr;
    }

    return { thought, content, raw: responseStr };
  }

  // ==========================================================================
  // JSON Validation
  // ==========================================================================

  /**
   * Validate content against a Zod schema
   */
  validate<T>(
    content: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): IValidationResult<T> {
    this.metrics.totalAttempts++;
    const result: IValidationResult<T> = {
      success: false,
      repairAttempted: false,
      repairSucceeded: false,
      raw: content,
    };

    // Step 1: Try direct JSON parse
    let parsed: JSONValue | undefined = undefined;
    let parseError: Error | null = null;

    try {
      parsed = JSON.parse(content.trim());
    } catch (e) {
      parseError = e as Error;
    }

    // Step 2: If parse failed and autoRepair enabled, try repairs
    if (parseError && this.config.autoRepair) {
      result.repairAttempted = true;
      this.metrics.repairAttempts++;

      const { repaired, appliedRepairs } = repairJSON(content);

      if (appliedRepairs.length > 0) {
        try {
          parsed = JSON.parse(repaired);
          result.repairSucceeded = true;
          this.metrics.successfulRepairs++;
        } catch {
          // Repair didn't help
          this.trackError("json_parse_error");
        }
      }
    }

    // Step 3: If still no parsed value, return error
    if (parsed === undefined) {
      result.errors = [{
        path: [],
        message: `Invalid JSON: ${parseError?.message || DEFAULT_UNKNOWN_ERROR_MESSAGE}`,
        code: "invalid_json",
      }];
      return result;
    }

    // Step 4: Validate against schema
    try {
      result.value = schema.parse(parsed);
      result.success = true;
      this.metrics.successfulValidations++;
      return result;
    } catch (e) {
      if (e instanceof ZodError) {
        result.errors = e.errors.map((err) => ({
          path: err.path.map(String),
          message: err.message,
          code: err.code,
          expected: "expected" in err ? String(err.expected) : undefined,
          received: "received" in err ? String(err.received) : undefined,
        }));
        this.trackError(`schema_${e.errors[0]?.code || "unknown"}`);
      } else {
        result.errors = [{
          path: [],
          message: String(e),
          code: "unknown_error",
        }];
        this.trackError("unknown_error");
      }
      return result;
    }
  }

  /**
   * Validate content using a named schema from the registry
   */
  validateWithSchema<K extends IOutputSchemaName>(
    content: string,
    schemaName: K,
  ): IValidationResult<z.infer<(typeof OutputSchemas)[K]>> {
    const schema = OutputSchemas[schemaName];
    // Use type assertion since we know OutputSchemas[K] matches the expected type
    return this.validate(
      content,
      schema as ZodType<z.infer<(typeof OutputSchemas)[K]>, ZodTypeDef, unknown>,
    );
  }

  // ==========================================================================
  // Combined Parsing & Validation
  // ==========================================================================

  /**
   * Parse XML tags and validate content against a schema
   */
  parseAndValidate<T>(
    raw: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): IValidationResult<T> {
    const parsed = this.parseXMLTags(raw);
    const result = this.validate(parsed.content, schema);
    result.parsed = parsed;
    result.raw = raw;
    return result;
  }

  /**
   * Parse XML tags and validate using a named schema
   */
  parseAndValidateWithSchema<K extends IOutputSchemaName>(
    raw: string,
    schemaName: K,
  ): IValidationResult<z.infer<(typeof OutputSchemas)[K]>> {
    const schema = OutputSchemas[schemaName];
    // Use type assertion since we know OutputSchemas[K] matches the expected type
    return this.parseAndValidate(
      raw,
      schema as ZodType<z.infer<(typeof OutputSchemas)[K]>, ZodTypeDef, unknown>,
    );
  }

  // ==========================================================================
  // LLM-Based Repair
  // ==========================================================================

  /**
   * Attempt to repair content using LLM
   */
  async repairWithLLM<T>(
    content: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    errors: IValidationError[],
  ): Promise<IValidationResult<T>> {
    if (!this.config.llmRepairFn) {
      throw new Error("LLM repair function not configured");
    }

    const schemaDescription = describeSchema(schema);
    const errorDescription = errors
      .map((e) => `- ${e.path.join(".")}: ${e.message}`)
      .join("\n");

    const repairedContent = await this.config.llmRepairFn(
      content,
      schemaDescription,
      errorDescription,
    );

    const result = this.validate(repairedContent, schema);
    result.repairAttempted = true;
    result.repairSucceeded = result.success;

    if (result.success) {
      this.metrics.successfulRepairs++;
    }

    return result;
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * Get current validation metrics
   */
  getMetrics(): IValidationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset validation metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalAttempts: 0,
      successfulValidations: 0,
      repairAttempts: 0,
      successfulRepairs: 0,
      failuresByErrorType: {},
    };
  }

  private trackError(errorType: string): void {
    this.metrics.failuresByErrorType[errorType] = (this.metrics.failuresByErrorType[errorType] || 0) + 1;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OutputValidator with default settings
 */
export function createOutputValidator(
  config?: IOutputValidatorConfig,
): OutputValidator {
  return new OutputValidator(config);
}

/**
 * Create an OutputValidator configured for plan validation
 */
export function createPlanValidator(): OutputValidator {
  return new OutputValidator({
    autoRepair: true,
    maxRepairAttempts: 3,
  });
}
