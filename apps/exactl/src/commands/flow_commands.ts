/**
 * @module FlowCommands
 * @path apps/exactl/src/commands/flow_commands.ts
 * @description Provides CLI commands for flow management and execution, including list, show, run, plan, history, and validation.
 * @architectural-layer CLI
 * @related-files [packages/flow/mod.ts, "apps/daemon/main.ts"]
 */

import { Table } from "@cliffy/table";
import { join } from "@std/path";
import { FlowLoader } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { DEFAULT_NONE_LABEL, MODEL_COLUMN_LABEL } from "@exaix/core";
import { BaseCommand } from "@exaix/cli/base.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { BindingOverlaySchema, BindOneOffSchema, type IRunBindingsFile } from "@exaix/schemas";
import { BINDING_OUTCOME_INVALID, BINDING_OUTCOME_UNBOUND, computeStartNetGrant, resolveFlowForAudit } from "@exaix/ai";

interface FlowListOptions {
  json?: boolean;
}

interface FlowShowOptions {
  json?: boolean;
}

interface FlowValidateOptions {
  json?: boolean;
}

interface FlowBindingsOptions {
  json?: boolean;
  overlay?: string[];
  bind?: string[];
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
    const flowsDir = join(this.config.system.root, this.config.paths.flows);
    this.flowLoader = new FlowLoader(flowsDir);
  }

  private exit(code?: Opt<number, Reason.OptionalInput>): never {
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
          step.agent_role,
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
          if (!step.agent_role || typeof step.agent_role !== "string" || step.agent_role.trim() === "") {
            errors.push(`IFlow '${flowId}' step '${step.id}' has invalid agent: ${step.agent_role}`);
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
      lines.push(`${step.id} (${step.agent_role})`);
      if (step.dependsOn.length > 0) {
        lines.push(`  ← ${step.dependsOn.join(", ")}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** `exactl flow bindings <flowId>`: resolve and print each LLM step's binding across all
   *  layers (config, daemon overlays, per-run inputs). Pure resolution. No key values.
   *  Non-zero exit on any issue. */
  async bindingsFlow(flowId: string, options: FlowBindingsOptions = {}): Promise<void> {
    try {
      const flow = await this.flowLoader.loadFlow(flowId);
      const run = await this.auditRunBindings(flowId, options);
      const probe = this.auditProbe();
      const { steps, layers } = await resolveFlowForAudit(flow, this.config, probe, run);
      const hosts = await computeStartNetGrant(this.config);
      const rows = steps.map((entry) => {
        if (entry.outcome.kind === BINDING_OUTCOME_UNBOUND || entry.outcome.kind === BINDING_OUTCOME_INVALID) {
          return {
            step_id: entry.stepId,
            agent_role: entry.agentRole,
            unbound: entry.outcome.kind === BINDING_OUTCOME_UNBOUND,
            invalid: entry.outcome.kind === BINDING_OUTCOME_INVALID,
          };
        }
        const binding = entry.outcome.binding;
        return {
          step_id: entry.stepId,
          agent_role: entry.agentRole,
          service: binding.service,
          model: binding.model,
          service_model_id: binding.service_model_id,
          transport: binding.transport,
          interface: binding.interface,
          sources: binding.sources,
          unbound: false,
        };
      });
      const hasIssues = steps.some((entry) => entry.issues.length > 0);
      const issues = steps.flatMap((entry) =>
        entry.issues.map((element) => ({ step_id: entry.stepId, code: element.code, detail: element.detail }))
      );

      if (options.json) {
        console.log(JSON.stringify({ layers, flow_id: flowId, steps: rows, issues, hosts }, null, 2));
      } else {
        const table = new Table()
          .header(["Step", "Role", "Service", MODEL_COLUMN_LABEL, "Service model id", "Transport", "Interface"])
          .border(true);
        for (const row of rows) {
          if (row.unbound || row.invalid) {
            table.push([
              row.step_id,
              row.agent_role,
              row.invalid ? "INVALID" : DEFAULT_NONE_LABEL,
              DEFAULT_NONE_LABEL,
              DEFAULT_NONE_LABEL,
              DEFAULT_NONE_LABEL,
              DEFAULT_NONE_LABEL,
            ]);
          } else {
            table.push([
              row.step_id,
              row.agent_role,
              row.service,
              row.model,
              row.service_model_id,
              row.transport,
              row.interface,
            ]);
          }
        }
        table.render();
        console.log();
        console.log(`Hosts (start-time network grant): ${hosts.length > 0 ? hosts.join(", ") : DEFAULT_NONE_LABEL}`);
        if (issues.length > 0) {
          console.log();
          console.log("Issues:");
          for (const issue of issues) {
            console.log(`  [${issue.code}] step=${issue.step_id} ${issue.detail}`);
          }
        }
      }
      if (hasIssues) this.exit(1);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error(`Flow '${flowId}' not found`);
      } else {
        console.error("Error resolving bindings:", error instanceof Error ? error.message : String(error));
      }
      this.exit(1);
    }
  }

  private async auditRunBindings(
    flowId: string,
    options: FlowBindingsOptions,
  ): Promise<Opt<IRunBindingsFile, Reason.OptionalContext>> {
    if (!options.overlay?.length && !options.bind?.length) return undefined;
    const overlays = [];
    for (const sourcePath of options.overlay ?? []) {
      const content = await Deno.readTextFile(sourcePath);
      overlays.push({
        source_path: sourcePath,
        sha256: await this.auditSha256(content),
        overlay: BindingOverlaySchema.parse(JSON.parse(content)),
      });
    }
    const binds = this.auditBinds(options.bind ?? []);
    return {
      schema: 1,
      trace_id: crypto.randomUUID(),
      request_path: flowId,
      request_sha256: "0".repeat(64),
      created_at: new Date().toISOString(),
      overlays,
      binds,
    };
  }

  private auditBinds(raw: string[]): ReturnType<typeof BindOneOffSchema.parse> {
    if (raw.length === 0) return [];
    const binds = [];
    for (const entry of raw) {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) throw new Error(`overlay_invalid: malformed --bind \"${entry}\"`);
      const selector = entry.slice(0, separatorIndex);
      const spec: Record<string, string> = {};
      for (const fieldAssignment of entry.slice(separatorIndex + 1).split(",")) {
        if (!fieldAssignment) continue;
        const equalsIndex = fieldAssignment.indexOf("=");
        if (equalsIndex <= 0) throw new Error(`overlay_invalid: malformed --bind \"${entry}\"`);
        spec[fieldAssignment.slice(0, equalsIndex)] = fieldAssignment.slice(equalsIndex + 1);
      }
      binds.push({ selector, spec });
    }
    return BindOneOffSchema.parse(binds);
  }

  private auditProbe(): { hasKey(name: string): boolean; hasOptIn(name: string): boolean } {
    return {
      hasKey: (name) => {
        const value = Deno.env.get(name);
        return Boolean(value && value.length > 0);
      },
      hasOptIn: (name) => Deno.env.get(name) === "1",
    };
  }

  private async auditSha256(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
