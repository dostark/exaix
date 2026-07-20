/**
 * @module InputValidationSchema
 * @path packages/schemas/src/input_validation.ts
 * @description Defines Zod validation schemas and sanitization utilities for user requests, agent IDs, and other CLI inputs to prevent injection and path traversal.
 * @architectural-layer Schemas
 * @ungrounded
 * @related-files ["apps/exactl/src/commands/request_commands.ts", apps/exactl/src/commands/blueprint_commands.ts]
 */

import { z } from "zod";
import { MockStrategy, ProviderType, SecurityMode } from "@exaix/core";
import {
  BLUEPRINT_NAME_MAX_LENGTH,
  FILENAME_MAX_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MODEL_NAME_MAX_LENGTH,
  PATH_MAX_LENGTH,
  PLAN_CONTENT_MAX_LENGTH,
  USER_REQUEST_MAX_LENGTH,
} from "@exaix/core";
import { AgentExecutionOptionsSchema } from "./agent_orchestrator.ts";

/**
 * Blueprint name validation - prevents path traversal and injection
 */
export const BlueprintNameSchema = z.string()
  .min(1, "Blueprint name cannot be empty")
  .max(BLUEPRINT_NAME_MAX_LENGTH, `Blueprint name too long (max ${BLUEPRINT_NAME_MAX_LENGTH} chars)`)
  .regex(/^[a-zA-Z0-9_-]+$/, "Blueprint name can only contain letters, numbers, hyphens, and underscores")
  .refine(
    (val: string) => !/\.\./.test(val),
    "Path traversal not allowed",
  )
  .refine(
    (val: string) =>
      !/[<>:"|?*]/.test(val) &&
      !val.split("").some((char: string) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
    "Special characters and control characters not allowed",
  );

/**
 * Portal name validation - prevents injection attacks
 */
export const PortalNameSchema = z.string()
  .min(1, "Portal name cannot be empty")
  .max(MAX_NAME_LENGTH, `Portal name too long (max ${MAX_NAME_LENGTH} chars)`)
  .regex(/^[a-zA-Z0-9_-]+$/, "Portal name can only contain letters, numbers, hyphens, and underscores");

/**
 * Agent ID validation - prevents path traversal
 */
export const AgentIdSchema = z.string()
  .min(1, "Agent ID cannot be empty")
  .max(MAX_ID_LENGTH, `Agent ID too long (max ${MAX_ID_LENGTH} chars)`)
  .regex(/^[a-zA-Z0-9_-]+$/, "Agent ID can only contain letters, numbers, hyphens, and underscores")
  .refine(
    (val: string) => !/\.\./.test(val),
    "Path traversal not allowed",
  );

/**
 * Trace ID validation - ensures valid UUID format
 */
export const TraceIdSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "Invalid trace ID format");

/**
 * User request content validation - prevents DoS and injection
 */
export const UserRequestSchema = z.string()
  .min(1, "Request cannot be empty")
  .max(USER_REQUEST_MAX_LENGTH, `Request too long (max ${USER_REQUEST_MAX_LENGTH} chars)`)
  .refine(
    (val: string) => !/<script[^>]*>.*?<\/script>/gis.test(val),
    "Script tags not allowed",
  )
  .refine(
    (val: string) => !/<iframe[^>]*>.*?<\/iframe>/gis.test(val),
    "Iframe tags not allowed",
  )
  .refine((val: string) => !/<img[^>]*>/gis.test(val), "Image tags not allowed")
  .refine(
    (val: string) =>
      !val.split("").some((char: string) => {
        const code = char.charCodeAt(0);
        return (code < 32 && code !== 10 && code !== 13 && code !== 9) || code === 127;
      }),
    "Non-whitespace control characters not allowed",
  );

/**
 * Plan content validation - prevents DoS and injection
 */
export const PlanSchema = z.string()
  .min(1, "Plan cannot be empty")
  .max(PLAN_CONTENT_MAX_LENGTH, `Plan too long (max ${PLAN_CONTENT_MAX_LENGTH} chars)`)
  .refine(
    (val: string) => !/<script[^>]*>.*?<\/script>/gis.test(val),
    "Script tags not allowed",
  )
  .refine(
    (val: string) =>
      !val.split("").some((char: string) => {
        const code = char.charCodeAt(0);
        return (code < 32 && code !== 10 && code !== 13 && code !== 9) || code === 127;
      }),
    "Non-whitespace control characters not allowed",
  );

/**
 * Security mode validation
 */
export const SecurityModeSchema = z.nativeEnum(SecurityMode);

/**
 * Model configuration validation - prevents prototype pollution
 */
export const ModelConfigSchema = z.object({
  provider: z.string().refine(
    (val: string) => {
      // Basic validation: must be a known provider or a GPT-style model
      const normalized = val.toLowerCase().trim();
      return Object.values(ProviderType).includes(normalized as ProviderType) ||
        normalized.startsWith("gpt-") ||
        normalized.startsWith("llama");
    },
    {
      message: "Provider must be a valid supported provider type",
    },
  ),
  model: z.string().min(1).max(MODEL_NAME_MAX_LENGTH),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(100000).optional(),
  base_url: z.string().url().optional(),
  timeout_ms: z.number().int().min(1000).max(300000).optional(),
  mock: z.object({
    strategy: z.nativeEnum(MockStrategy),
    fixtures_dir: z.string().optional(),
    error_message: z.string().optional(),
    delay_ms: z.number().int().positive().optional(),
  }).optional(),
}).strict();

/**
 * Execution context validation
 */
export const ExecutionContextSchema = z.object({
  trace_id: TraceIdSchema,
  request_id: z.string().min(1).max(MAX_ID_LENGTH),
  request: UserRequestSchema,
  plan: PlanSchema,
  portal: PortalNameSchema,
  step_number: z.number().int().positive().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.date().optional(),
  skills_context: z.string().optional(),
  /** All of the current plan's steps concatenated, set once per plan (PlanExecutor.executeSteps). CliDelegateStrategy uses this on a trace's first turn so a headless CLI session sees the whole task, not just the current step's fragment. */
  full_plan: z.string().optional(),
}).strict();

type ExecutionContextInput = z.input<typeof ExecutionContextSchema>;
type AgentExecutionOptionsInput = z.input<typeof AgentExecutionOptionsSchema>;

/**
 * Input validation utility class
 */
export class InputValidator {
  /**
   * Validates execution context
   */
  static validateExecutionContext(rawContext: ExecutionContextInput): z.infer<typeof ExecutionContextSchema> {
    return ExecutionContextSchema.parse(rawContext);
  }

  /**
   * Validates agent execution options
   */
  static validateAgentExecutionOptions(
    rawOptions: AgentExecutionOptionsInput,
  ): z.output<typeof AgentExecutionOptionsSchema> {
    return AgentExecutionOptionsSchema.parse(rawOptions);
  }

  /**
   * Validates blueprint name
   */
  static validateBlueprintName(rawName: z.input<typeof BlueprintNameSchema>): z.infer<typeof BlueprintNameSchema> {
    return BlueprintNameSchema.parse(rawName);
  }

  /**
   * Validates model configuration
   */
  static validateModelConfig(rawConfig: z.input<typeof ModelConfigSchema>): z.infer<typeof ModelConfigSchema> {
    return ModelConfigSchema.parse(rawConfig);
  }
}

/**
 * Input sanitization utility class
 */
export class InputSanitizer {
  /**
   * Helper function to remove control characters from a string
   */
  private static removeControlChars(str: string): string {
    return str.split("").filter((char) => {
      const code = char.charCodeAt(0);
      // Keep printable chars, tabs, newlines, and carriage returns; remove other control chars and DEL
      return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
    }).join("");
  }

  /**
   * Sanitizes filename by removing dangerous characters
   */
  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"|?*\\/]/g, "_") // Replace dangerous chars with underscore
      .replace(/\.\./g, "_._") // Replace .. with _._
      .replace(/^\.+/, "") // Remove leading dots
      .replace(/\.+$/, "") // Remove trailing dots
      .substring(0, FILENAME_MAX_LENGTH); // Limit length
  }

  /**
   * Sanitizes file path by preventing traversal
   */
  static sanitizePath(path: string): string {
    return path
      .replace(/\.\./g, "") // Remove parent directory references
      .replace(/[<>:"|?*]/g, "_") // Replace dangerous chars
      .replace(/^\/+/, "") // Remove leading slashes
      .replace(/\/+$/, "") // Remove trailing slashes
      .substring(0, PATH_MAX_LENGTH); // Limit path length
  }

  /**
   * Sanitizes user text input
   */
  static sanitizeUserText(text: string): string {
    return this.removeControlChars(text)
      .replace(/<script[^>]*>.*?<\/script>/gis, "[SCRIPT REMOVED]") // Remove script tags
      .replace(/<iframe[^>]*>.*?<\/iframe>/gis, "[IFRAME REMOVED]") // Remove iframe tags
      .substring(0, USER_REQUEST_MAX_LENGTH); // Limit length
  }

  /**
   * Sanitizes plan text
   */
  static sanitizePlanText(text: string): string {
    return this.removeControlChars(text)
      .replace(/<script[^>]*>.*?<\/script>/gis, "[SCRIPT REMOVED]") // Remove script tags
      .substring(0, PLAN_CONTENT_MAX_LENGTH); // Limit length
  }

  /**
   * Limits text length with truncation
   */
  static limitTextLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    return text.substring(0, maxLength - 3) + "...";
  }
}
