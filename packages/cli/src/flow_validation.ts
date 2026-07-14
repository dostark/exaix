/**
 * @module FlowValidation
 * @path packages/cli/src/flow_validation.ts
 * @related-files []
 * @description Provides CLI validation for flow dynamic step execution mode,
 * outputting errors for write tools and warnings for missing configurations.
 * @architectural-layer CLI
 * @ungrounded
 */

import { FlowStepExecutionMode } from "@exaix/core";
import type { IFlow } from "@exaix/schemas/flow.ts";

export interface ICliValidationReport {
  errors: string[];
  warnings: string[];
  valid: boolean;
}

export function validateFlowForCli(
  flow: IFlow,
  writeTools: ReadonlySet<string>,
  readOnlyTools: ReadonlySet<string>,
): ICliValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const step of flow.steps) {
    if (step.execution_mode !== FlowStepExecutionMode.DYNAMIC) {
      continue;
    }

    const permittedTools = step.permitted_tools ?? [];
    for (const tool of permittedTools) {
      if ((writeTools as Set<string>).has(tool)) {
        const readOnlyToolsList = [...readOnlyTools].join(", ");
        errors.push(
          `Step "${step.id}": "${tool}" is a write tool. ` +
            `Dynamic steps may only use read-only tools: [${readOnlyToolsList}]`,
        );
      }
    }

    if (!step.permitted_tools || step.permitted_tools.length === 0) {
      warnings.push(
        `Step "${step.id}": no permitted_tools specified. ` +
          `Will use identity "${step.identity}" permitted_tools at runtime. ` +
          `Consider declaring permitted_tools explicitly for clarity.`,
      );
    }

    if (!step.timeout) {
      warnings.push(
        `Step "${step.id}": no timeout set for dynamic step. ` +
          `Default max_iterations (10) applies. Consider setting timeout_ms.`,
      );
    }
  }

  return { errors, warnings, valid: errors.length === 0 };
}
