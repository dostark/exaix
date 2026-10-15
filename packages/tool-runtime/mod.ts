/**
 * @module ToolRuntime
 * @path packages/tool-runtime/mod.ts
 * @related-files []
 * @architectural-layer Services
 * @description Barrel for @exaix/tool-runtime.
 */

export * from "./src/tool_registry.ts";
export * from "./src/deno_task_runner.ts";
export * from "./src/aci_doc_renderer.ts";
export * from "./src/aci_example_validator.ts";
export * from "./src/tool_schemas.ts";
export * from "./src/tool_call_canonicalizer.ts";
export * from "./src/tool_reflector.ts";
// The tool-call contract lives in @exaix/core/types, so re-export it for the package surface.
export type { IToolCall, IToolReflectorMetrics } from "@exaix/core/types";
export * from "./src/cli_confirmation_interceptor.ts";
export * from "./src/notification_queue_confirmation_interceptor.ts";
export * from "./src/confirmation_interceptor_factory.ts";
export * from "./src/tool_validation_reporter.ts";
export { createOutputValidator, createPlanValidator, OutputSchemas, OutputValidator } from "./src/output_validator.ts";
export { createPathSecurity, PathSecurity } from "./src/path_security.ts";
export { PathAccessError, PathTraversalError } from "./src/types.ts";
export type { IActivityJournal, IMiddlewarePipeline, IPathSecurityOps, IToolAgentExecutor } from "./src/types.ts";
export type {
  IActionSequence,
  IAnalysis,
  IEvaluation,
  IOutputFormat,
  IOutputSchemaName,
  IOutputValidator,
  IOutputValidatorConfig,
  IParsedXMLOutput,
  ISimpleResponse,
  IToolCall as OutputValidationToolCall,
  IValidationError,
  IValidationMetrics,
  IValidationResult,
  OutputSchemaName,
  ValidationError,
} from "./src/output_validator.ts";
