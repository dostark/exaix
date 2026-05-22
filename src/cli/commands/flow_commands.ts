/**
 * @module FlowCommands
 * @path src/cli/commands/flow_commands.ts
 * @description Provides CLI commands for flow management and execution, including list, show, run, plan, history, and validation.
 * @architectural-layer CLI
 * @related-files [packages/flow-storage/mod.ts, "src/main.ts"]
 */

import { Table } from "@cliffy/table";
import { join } from "@std/path";
import { FlowLoader } from "@exaix/flow-storage";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { DEFAULT_NONE_LABEL } from "@exaix/core";
import { BaseCommand } from "@exaix/cli/base.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";

interface FlowListOptions {
  json?: boolean;
}

interface FlowShowOptions {
  json?: boolean;
}

interface FlowValidateOptions {
  json?: boolean;
}

interface IFlowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class FlowCommands extends BaseCommand {
  private flowLoader: FlowLoader;

  constructor(context: ICliApplicationContext) {
    super(context);
    const flowsDir = join(this.config.system.root, this.config.paths.blueprints, this.config.paths.flows);
    this.flowLoader = new FlowLoader(flowsDir);
  }

  private exit(code?: number): never {
    const testExit = (this.context as ICliApplicationContext & { exit?: (code?: number) => never }).exit;
    if (typeof testExit === "function") {
      return testExit(code);
    }
    return Deno.exit(code);
  }

  async listFlows(options: FlowListOptions = {}): Promise<void> {
    try {
      const flows = await this.flowLoader.loadAllFlows();

      if (options.json) {
        console.log(JSON.stringify(
          flows.map((flow) => ({
            id: flow.id,
            name: flow.name,
            description: flow.description,
            version: flow.version,
            steps: flow.steps.length,
          })),
          null,
          2,
        ));
        return;
      }

      if (flows.length === 0) {
        console.log("No flows found");
        return;
      }

      const table = new Table()
        .header(["ID", "Name", "Version", "Steps", "Description"])
        .border(true);

      for (const flow of flows) {
        table.push([
          flow.id,
          flow.name,
          flow.version,
          flow.steps.length.toString(),
          flow.description,
        ]);
      }

      table.render();
    } catch (error) {
      console.error("Error listing flows:", error instanceof Error ? error.message : String(error));
      this.exit(1);
    }
  }

  async showFlow(flowId: string, options: FlowShowOptions = {}): Promise<void> {
    try {
      const flow = await this.flowLoader.loadFlow(flowId);

      if (options.json) {
        console.log(JSON.stringify(flow, null, 2));
        return;
      }

      console.log(`Flow: ${flow.name} (${flow.id})`);
      console.log(`Version: ${flow.version}`);
      console.log(`Description: ${flow.description}`);
      console.log();

      // Display dependency graph
      console.log("Dependency Graph:");
      const graph = this.renderDependencyGraph(flow);
      console.log(graph);
      console.log();

      // Display steps table
      const stepsTable = new Table()
        .header(["ID", "Agent", "Dependencies", "Description"])
        .border(true);

      for (const step of flow.steps) {
        stepsTable.push([
          step.id,
          step.identity,
          step.dependsOn.length > 0 ? step.dependsOn.join(", ") : DEFAULT_NONE_LABEL,
          step.name,
        ]);
      }

      stepsTable.render();

      // Display flow settings
      console.log();
      console.log("Settings:");
      console.log(`  Max Parallelism: ${flow.settings?.maxParallelism || "unlimited"}`);
      console.log(`  Fail Fast: ${flow.settings?.failFast !== false}`);
      console.log(`  Output Format: ${flow.output?.format || "markdown"}`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error(`Flow '${flowId}' not found`);
      } else {
        console.error("Error showing flow:", error instanceof Error ? error.message : String(error));
      }
      this.exit(1);
    }
  }

  async validateFlow(flowId: string, options: FlowValidateOptions = {}): Promise<void> {
    try {
      const filePath = join(
        this.config.system.root,
        this.config.paths.blueprints,
        this.config.paths.flows,
        `${flowId}.flow.yaml`,
      );
      const validation = this.context.flowValidator
        ? await this.context.flowValidator.validateFile(filePath)
        : await this.validateFlowWithoutService(flowId);

      if (options.json) {
        console.log(JSON.stringify(
          {
            valid: validation.isValid,
            errors: validation.errors,
            warnings: validation.warnings,
          },
          null,
          2,
        ));
        return;
      }

      if (validation.isValid) {
        console.log(`✅ Flow '${flowId}' is valid`);
      } else {
        console.log(`❌ Flow '${flowId}' validation failed:`);
        console.log(validation.errors.join("\n"));
        this.exit(1);
      }
    } catch (error) {
      if (error instanceof Error && (error.message === "EXIT" || error.message === "DENO_EXIT")) {
        throw error;
      }
      console.error("Error validating flow:", error instanceof Error ? error.message : String(error));
      this.exit(1);
    }
  }

  private async validateFlowWithoutService(flowId: string): Promise<IFlowValidationResult> {
    try {
      const flow = await this.flowLoader.loadFlow(flowId);
      const errors: string[] = [];

      if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
        errors.push(`IFlow '${flowId}' must contain at least one step`);
      } else {
        for (const step of flow.steps) {
          if (!step.identity || typeof step.identity !== "string" || step.identity.trim() === "") {
            errors.push(`IFlow '${flowId}' step '${step.id}' has invalid agent: ${step.identity}`);
            break;
          }
        }

        if (flow.output?.from) {
          const stepIds = new Set(flow.steps.map((step) => step.id));
          const outputFrom = flow.output.from;
          if (typeof outputFrom === "string" && !stepIds.has(outputFrom)) {
            errors.push(`IFlow '${flowId}' output.from references non-existent step: ${outputFrom}`);
          } else if (Array.isArray(outputFrom)) {
            const invalid = outputFrom.find((stepId) => !stepIds.has(stepId));
            if (invalid) {
              errors.push(`IFlow '${flowId}' output.from references non-existent step: ${invalid}`);
            }
          }
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings: [],
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      };
    }
  }

  private renderDependencyGraph(flow: IFlow): string {
    // Simple text-based dependency graph
    const lines: string[] = [];
    for (const step of flow.steps) {
      lines.push(`${step.id} (${step.identity})`);
      if (step.dependsOn.length > 0) {
        lines.push(`  ← ${step.dependsOn.join(", ")}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}
