/**
 * @module FlowValidation
 * @path src/cli/flow_validation.ts
 * @description Provides CLI validation for flow dynamic step execution mode,
 * outputting errors for write tools and warnings for missing configurations.
 * @architectural-layer CLI
 * @related-files [src/cli/commands/flow_commands.ts, src/shared/constants.ts]
 */

import { READ_ONLY_TOOLS, WRITE_TOOLS } from "@exaix/mcp";
import { FlowStepExecutionMode } from "@exaix/core";
import type { IFlow } from "@exaix/schemas/flow.ts";

/**
 * CLI validation report with errors and warnings
 */
export interface ICliValidationReport {
  errors: string[];
  warnings: string[];
  valid: boolean;
}

/**
 * Validates a flow for dynamic step execution mode issues.
 * Outputs errors for write tools in permitted_tools and warnings for missing configurations.
 *
 * @param flow - The flow to validate
 * @returns Validation report with errors, warnings, and valid flag
 */
export function validateFlowForCli(flow: IFlow): ICliValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const step of flow.steps) {
    // Skip non-dynamic steps
    if (step.execution_mode !== FlowStepExecutionMode.DYNAMIC) {
      continue;
    }

    // Error: write tool in permitted_tools
    const permittedTools = step.permitted_tools ?? [];
    for (const tool of permittedTools) {
      if (WRITE_TOOLS.has(tool)) {
        const readOnlyToolsList = [...READ_ONLY_TOOLS].join(", ");
        errors.push(
          `Step "${step.id}": "${tool}" is a write tool. ` +
            `Dynamic steps may only use read-only tools: [${readOnlyToolsList}]`,
        );
      }
    }

    // Warning: dynamic step with no permitted_tools (will fall back to identity toolset)
    if (!step.permitted_tools || step.permitted_tools.length === 0) {
      warnings.push(
        `Step "${step.id}": no permitted_tools specified. ` +
          `Will use identity "${step.identity}" permitted_tools at runtime. ` +
          `Consider declaring permitted_tools explicitly for clarity.`,
      );
    }

    // Warning: dynamic step with timeout not set (may iterate indefinitely)
    if (!step.timeout) {
      warnings.push(
        `Step "${step.id}": no timeout set for dynamic step. ` +
          `Default max_iterations (10) applies. Consider setting timeout_ms.`,
      );
    }
  }

  return { errors, warnings, valid: errors.length === 0 };
}
