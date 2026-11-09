/**
 * @module FlowCommands
 * @path apps/exactl/src/commands/flow_commands.ts
 * @description Provides CLI commands for flow management and execution, including list, show, run, plan, history, and validation.
 * @architectural-layer CLI
 * @related-files [packages/flow/mod.ts, "apps/daemon/main.ts"]
 */

import { cellText, ColumnHeader, type ExaCtlOutputRenderer, toRow } from "../output/exactl_output.ts";
import type { IExaCtlColumn } from "@exaix/cli";
import type { IJsonRow } from "../output/exactl_output.ts";
import { Table } from "@cliffy/table";
import { join } from "@std/path";
import { FlowLoader } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { DEFAULT_NONE_LABEL, MODEL_COLUMN_LABEL } from "@exaix/core";
import { isCapabilityEligible } from "@exaix/core/composer";
import { BaseCommand } from "@exaix/cli/base.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { IFlowValidationResult, Opt, Reason } from "@exaix/core/types";
import { BindingOverlaySchema, BindOneOffSchema, type IRunBindingsFile } from "@exaix/schemas";
import {
  BINDING_OUTCOME_INVALID,
  BINDING_OUTCOME_UNBOUND,
  computeStartNetGrant,
  parseOverlayText,
  readRegularOverlayFile,
  resolveFlowForAudit,
} from "@exaix/ai";

interface FlowBindingsOptions {
  overlay?: string[];
  bind?: string[];
}

const FLOW_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "ID", value: (row) => cellText(row.id) },
  { header: ColumnHeader.NAME, value: (row) => cellText(row.name) },
  { header: "Version", value: (row) => cellText(row.version) },
  { header: "Steps", value: (row) => String(row.steps) },
  { header: "Description", value: (row) => cellText(row.description) },
  { header: "Capabilities", value: (row) => capabilityLabel(row) },
];

/** The capability column of a flow row: none, eligible in this edition, or unavailable with the missing names. */
function capabilityLabel(row: IJsonRow): string {
  const required = Array.isArray(row.requiresCapabilities) ? row.requiresCapabilities.map(String) : [];
  if (required.length === 0) return DEFAULT_NONE_LABEL;
  return row.tierEligible === true ? "eligible (runtime unverified)" : `unavailable (needs ${required.join(", ")})`;
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

  async listFlows(renderer: ExaCtlOutputRenderer): Promise<void> {
    try {
      const flows = await this.flowLoader.loadAllFlows();
      const rows = flows.map((flow) =>
        toRow({
          id: flow.id,
          name: flow.name,
          description: flow.description,
          version: flow.version,
          steps: flow.steps.length,
          requiresCapabilities: flow.requires_capabilities ?? [],
          tierEligible: (flow.requires_capabilities ?? []).every((capability) =>
            isCapabilityEligible(capability, this.context.edition)
          ),
          runtimeAvailability: "unknown",
        })
      );
      await renderer.list(rows, FLOW_COLUMNS, (row) => cellText(row.id));
    } catch (error) {
      console.error("Error listing flows:", error instanceof Error ? error.message : String(error));
      this.exit(1);
    }
  }

  async showFlow(flowId: string, renderer: ExaCtlOutputRenderer): Promise<void> {
    try {
      const flow = await this.flowLoader.loadFlow(flowId);

      if (renderer.machine) {
        await renderer.item(toRow(flow), []);
        return;
      }

      await renderer.text(`Flow: ${flow.name} (${flow.id})`);
      await renderer.text(`Version: ${flow.version}`);
      await renderer.text(`Description: ${flow.description}`);
      await renderer.text("");

      // Display dependency graph
      await renderer.text("Dependency Graph:");
      const graph = this.renderDependencyGraph(flow);
      await renderer.text(graph);
      await renderer.text("");

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

      await renderer.text(stepsTable.toString());

      // Display flow settings
      await renderer.text("");
      await renderer.text("Settings:");
      await renderer.text(`  Max Parallelism: ${flow.settings?.maxParallelism || "unlimited"}`);
      await renderer.text(`  Fail Fast: ${flow.settings?.failFast !== false}`);
      await renderer.text(`  Output Format: ${flow.output?.format || "markdown"}`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error(`Flow '${flowId}' not found`);
      } else {
        console.error("Error showing flow:", error instanceof Error ? error.message : String(error));
      }
      this.exit(1);
    }
  }

  async validateFlow(flowId: string, renderer: ExaCtlOutputRenderer): Promise<void> {
    try {
      const filePath = join(
        this.config.system.root,
        this.config.paths.flows,
        `${flowId}.flow.yaml`,
      );
      const validation = this.context.flowValidator
        ? await this.context.flowValidator.validateFile(filePath)
        : await this.validateFlowWithoutService(flowId);

      if (renderer.machine) {
        await renderer.item(
          toRow({ valid: validation.isValid, errors: validation.errors, warnings: validation.warnings }),
          [],
        );
        if (!validation.isValid) this.exit(1);
        return;
      }

      if (validation.isValid) {
        await renderer.text(`✅ Flow '${flowId}' is valid`);
      } else {
        await renderer.text(`❌ Flow '${flowId}' validation failed:`);
        await renderer.text(validation.errors.join("\n"));
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
  async bindingsFlow(flowId: string, options: FlowBindingsOptions, renderer: ExaCtlOutputRenderer): Promise<void> {
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

      if (renderer.machine) {
        await renderer.item(toRow({ layers, flow_id: flowId, steps: rows, issues, hosts }), []);
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
        await renderer.text(table.toString());
        await renderer.text("");
        await renderer.text(
          `Hosts (start-time network grant): ${hosts.length > 0 ? hosts.join(", ") : DEFAULT_NONE_LABEL}`,
        );
        if (issues.length > 0) {
          await renderer.text("");
          await renderer.text("Issues:");
          for (const issue of issues) {
            await renderer.text(`  [${issue.code}] step=${issue.step_id} ${issue.detail}`);
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
      const content = await readRegularOverlayFile(sourcePath);
      overlays.push({
        source_path: sourcePath,
        sha256: await this.auditSha256(content),
        overlay: BindingOverlaySchema.parse(parseOverlayText(sourcePath, content)),
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
