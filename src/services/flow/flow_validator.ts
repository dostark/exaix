/**
 * @module FlowValidator
 * @path src/services/flow/flow_validator.ts
 * @description Validates flow definitions, including structure, dependencies, and agent references.
 * @architectural-layer Services
 * @related-files [src/flows/flow_loader.ts, "packages/request/src/router.ts"]
 */
import type { FlowLoader } from "../../flows/flow_loader.ts";
import { DependencyResolver } from "../../flows/dependency_resolver.ts";
import type { IFlowValidator } from "@exaix/request";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";

/**
 * FlowValidatorImpl - Validates flow definitions before execution
 * Implements comprehensive validation for flow-aware request routing
 */
export class FlowValidatorImpl implements IFlowValidator {
  constructor(
    private flowLoader: FlowLoader,
    private blueprintsPath: string,
  ) {}

  /**
   * Validate an IFlow object
   */
  validate(flow: IFlow): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const flowId = flow.id || "unnamed";

    const structureError = this.validateStructure(flowId, flow);
    if (structureError) errors.push(structureError);

    const hasValidSteps = Array.isArray(flow.steps) && flow.steps.length > 0;
    if (hasValidSteps) {
      const dependencyError = this.validateDependencies(flowId, flow.steps);
      if (dependencyError) errors.push(dependencyError);

      const agentError = this.validateStepAgents(flowId, flow.steps);
      if (agentError) errors.push(agentError);

      const outputError = this.validateOutput(flowId, flow);
      if (outputError) errors.push(outputError);
    }

    return Promise.resolve({
      isValid: errors.length === 0,
      errors,
      warnings: [],
    });
  }

  /**
   * Validate a flow from a file path
   */
  async validateFile(path: string): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    try {
      // Simplistic ID extraction from path
      const flowId = path.split("/").pop()?.replace(".flow.yaml", "") || "unknown";
      const flow = await this.flowLoader.loadFlow(flowId);
      return await this.validate(flow);
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      };
    }
  }

  /**
   * Validate a flow by ID (legacy method)
   */
  async validateFlow(flowId: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const exists = await this.flowLoader.flowExists(flowId);
      if (!exists) {
        return { valid: false, error: `IFlow '${flowId}' not found` };
      }

      const loadResult = await this.tryLoadFlow(flowId);
      if (loadResult.error || !loadResult.flow) {
        return { valid: false, error: loadResult.error || `IFlow '${flowId}' failed to load` };
      }

      const result = await this.validate(loadResult.flow);
      return {
        valid: result.isValid,
        error: result.errors.length > 0 ? result.errors[0] : undefined,
      };
    } catch (error) {
      return {
        valid: false,
        error: `IFlow '${flowId}' validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async tryLoadFlow(
    flowId: string,
  ): Promise<{ flow?: Awaited<ReturnType<FlowLoader["loadFlow"]>>; error?: string }> {
    try {
      const flow = await this.flowLoader.loadFlow(flowId);
      return { flow };
    } catch (loaderErr) {
      const msg = loaderErr instanceof Error ? loaderErr.message : String(loaderErr);
      if (msg.includes("Agent reference cannot be empty")) {
        return { error: `IFlow '${flowId}' has invalid agent` };
      }
      return { error: `IFlow '${flowId}' validation failed: ${msg}` };
    }
  }

  private validateStructure(flowId: string, flow: IFlow): string | null {
    if (!flow.steps || flow.steps.length === 0) {
      return `IFlow '${flowId}' must contain at least one step`;
    }
    return null;
  }

  private validateDependencies(flowId: string, steps: IFlowStep[]): string | null {
    const resolver = new DependencyResolver(steps);
    try {
      resolver.topologicalSort();
      return null;
    } catch (error) {
      return `IFlow '${flowId}' has invalid dependencies: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private validateStepAgents(flowId: string, steps: IFlowStep[]): string | null {
    for (const step of steps) {
      if (!step.identity || typeof step.identity !== "string" || step.identity === "") {
        return `IFlow '${flowId}' step '${step.id}' has invalid identity: ${step.identity}`;
      }
    }
    return null;
  }

  private validateOutput(flowId: string, flow: IFlow): string | null {
    if (!flow.output) return null;
    if (!flow.output.from || !flow.output.format) {
      return `IFlow '${flowId}' has invalid output configuration`;
    }

    const outputFrom = flow.output.from;
    const stepIds = new Set(flow.steps.map((s) => s.id));

    if (typeof outputFrom === "string") {
      if (stepIds.has(outputFrom)) return null;
      return `IFlow '${flowId}' output.from references non-existent step: ${outputFrom}`;
    }

    if (Array.isArray(outputFrom)) {
      for (const stepId of outputFrom) {
        if (!stepIds.has(stepId)) {
          return `IFlow '${flowId}' output.from references non-existent step: ${stepId}`;
        }
      }
      return null;
    }

    return `IFlow '${flowId}' has invalid output configuration`;
  }
}
