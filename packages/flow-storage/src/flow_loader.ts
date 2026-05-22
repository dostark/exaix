/**
 * @module FlowLoader
 * @path packages/flow-storage/src/flow_loader.ts
 * @description Handles loading and managing flow definitions from the file system, including dynamic import and import rewriting for blueprint execution.
 * @architectural-layer FlowStorage
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { FlowStepExecutionMode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { WRITE_TOOLS } from "@exaix/mcp";

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

export class FlowLoader {
  private flowsDir: string;

  constructor(flowsDir: string) {
    this.flowsDir = flowsDir;
  }

  async loadAllFlows(): Promise<IFlow[]> {
    const flows: IFlow[] = [];

    try {
      const entries = [];
      for await (const entry of Deno.readDir(this.flowsDir)) {
        if (entry.isFile && entry.name.endsWith(".flow.yaml")) {
          entries.push(entry.name);
        }
      }

      for (const fileName of entries) {
        try {
          const flowId = fileName.replace(".flow.yaml", "");
          const flow = await this.loadFlow(flowId);
          flows.push(flow);
        } catch (error) {
          console.warn(`Failed to load flow from ${fileName}:`, error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }

    return flows;
  }

  async loadFlow(flowId: string): Promise<IFlow> {
    const fileName = `${flowId}.flow.yaml`;
    const filePath = join(this.flowsDir, fileName);

    try {
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

      let flow: IFlow;
      try {
        flow = FlowSchema.parse(parsedYaml);
      } catch (e) {
        throw new Error(`Flow file ${fileName} does not match Flow schema: ${e}`);
      }

      if (flow.id !== flowId) {
        throw new Error(`Flow ID '${flow.id}' does not match filename '${flowId}'`);
      }

      const validationErrors = validateDynamicStepTools(flow.steps);
      if (validationErrors.length > 0) {
        throw new Error(`Flow validation failed:\n  - ${validationErrors.join("\n  - ")}`);
      }

      return flow;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Failed to load flow '${flowId}': module not found`);
      }
      throw new Error(`Failed to load flow '${flowId}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
