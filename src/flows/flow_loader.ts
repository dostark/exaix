/**
 * @module FlowLoader
 * @path src/flows/flow_loader.ts
 * @description Handles loading and managing flow definitions from the file system, including dynamic import and import rewriting for blueprint execution.
 * @architectural-layer Flows
 * @related-files [src/flows/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { FlowStepExecutionMode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { WRITE_TOOLS } from "@exaix/mcp";

/**
 * Validate that dynamic steps do not contain write tools in permitted_tools.
 * Returns an array of error messages (empty if valid).
 */
function validateDynamicStepTools(steps: IFlowStep[]): string[] {
  const errors: string[] = [];

  for (const step of steps) {
    if (step.execution_mode !== FlowStepExecutionMode.DYNAMIC) continue;
    if (!step.permitted_tools || step.permitted_tools.length === 0) continue;

    for (const tool of step.permitted_tools) {
      if (WRITE_TOOLS.has(tool)) {
        errors.push(
          `Step "${step.id}": tool "${tool}" is a write tool and cannot be ` +
            `used in execution_mode: "dynamic". Move to a declared step.`,
        );
      }
    }
  }

  return errors;
}

/**
 * FlowLoader handles loading and managing flow definitions from the file system.
 * Loads YAML flow files from the /Blueprints/Flows/ directory.
 */
export class FlowLoader {
  private flowsDir: string;

  constructor(flowsDir: string) {
    this.flowsDir = flowsDir;
  }

  /**
   * Load all flow files from the flows directory.
   * Only loads files ending with .flow.yaml and ignores invalid files.
   */
  async loadAllFlows(): Promise<IFlow[]> {
    const flows: IFlow[] = [];

    try {
      // Read all files in the flows directory
      const entries = [];
      for await (const entry of Deno.readDir(this.flowsDir)) {
        if (entry.isFile && entry.name.endsWith(".flow.yaml")) {
          entries.push(entry.name);
        }
      }

      // Load each flow file
      for (const fileName of entries) {
        try {
          const flowId = fileName.replace(".flow.yaml", "");
          const flow = await this.loadFlow(flowId);
          flows.push(flow);
        } catch (error) {
          console.warn(`Failed to load flow from ${fileName}:`, error instanceof Error ? error.message : String(error));
          // Continue loading other flows
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Directory doesn't exist, return empty array
        return [];
      }
      throw error;
    }

    return flows;
  }

  /**
   * Load a specific flow by its ID.
   * The flow file should be named {flowId}.flow.yaml
   */
  async loadFlow(flowId: string): Promise<IFlow> {
    const fileName = `${flowId}.flow.yaml`;
    const filePath = join(this.flowsDir, fileName);

    try {
      // Read the yaml file content
      const originalContent = await Deno.readTextFile(filePath);

      let parsedYaml: JSONValue;
      try {
        parsedYaml = parseYaml(originalContent) as JSONValue;
      } catch (e) {
        throw new Error(`Invalid YAML format in ${fileName}: ${e}`);
      }

      if (!parsedYaml || typeof parsedYaml !== "object") {
        throw new Error(`Flow file ${fileName} does not contain a valid flow definition object`);
      }

      // Validate and parse the flow using FlowSchema
      let flow: IFlow;
      try {
        flow = FlowSchema.parse(parsedYaml);
      } catch (e) {
        throw new Error(`Flow file ${fileName} does not match Flow schema: ${e}`);
      }

      // Validate that the flow ID matches the filename
      if (flow.id !== flowId) {
        throw new Error(`Flow ID '${flow.id}' does not match filename '${flowId}'`);
      }

      // Validate dynamic step tool permissions (Phase 56)
      const validationErrors = validateDynamicStepTools(flow.steps);
      if (validationErrors.length > 0) {
        throw new Error(`Flow validation failed:\n  - ${validationErrors.join("\n  - ")}`);
      }

      return flow;
    } catch (error) {
      // Normalize error messages so callers can assert on the standard message format
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Failed to load flow '${flowId}': module not found`);
      }
      throw new Error(`Failed to load flow '${flowId}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a flow exists without loading it.
   */
  async flowExists(flowId: string): Promise<boolean> {
    const fileName = `${flowId}.flow.yaml`;
    const filePath = join(this.flowsDir, fileName);

    try {
      const stat = await Deno.stat(filePath);
      return stat.isFile;
    } catch {
      return false;
    }
  }

  /**
   * Get a list of available flow IDs.
   */
  async listFlowIds(): Promise<string[]> {
    const flowIds: string[] = [];

    try {
      for await (const entry of Deno.readDir(this.flowsDir)) {
        if (entry.isFile && entry.name.endsWith(".flow.yaml")) {
          const flowId = entry.name.replace(".flow.yaml", "");
          flowIds.push(flowId);
        }
      }
    } catch {
      // Directory doesn't exist, return empty array
    }

    return flowIds;
  }
}
