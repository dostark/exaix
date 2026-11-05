/**
 * @module DynamicExecutorTestHelper
 * @path packages/flow/tests/helpers/dynamic_executor.ts
 * @description Builds dynamic executors with the canonical test tool surface and explicit dependency overrides.
 * @architectural-layer Test
 * @related-files [packages/flow/src/dynamic_step_executor.ts]
 */
import { BlueprintFrontmatterSchema, type IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { DynamicStepExecutor, type IDynamicStepExecutorDependencies } from "@exaix/flow";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS } from "@exaix/mcp";

export function createDynamicExecutor(dependencies: IDynamicStepExecutorDependencies): DynamicStepExecutor {
  return new DynamicStepExecutor({
    dynamicModeTools: DYNAMIC_MODE_TOOLS,
    dynamicModeApprovalTools: DYNAMIC_MODE_APPROVAL_TOOLS,
    ...dependencies,
  });
}

export function dynamicAgentRole(permittedTools: string[], agentRole: string, name: string): IBlueprintFrontmatter {
  return BlueprintFrontmatterSchema.parse({
    agent_role: agentRole,
    name,
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: permittedTools,
  });
}
