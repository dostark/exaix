/**
 * @module FlowReporter
 * @path src/services/flow/flow_reporter.ts
 * @description Generates comprehensive reports for flow executions, analyzing multi-agent orchestration results.
 * @architectural-layer Services
 * @related-files [src/flows/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "../core/db.ts";
import type { IFlowResult } from "../../flows/flow_runner.ts";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { ICON_FAILURE, ICON_SUCCESS } from "@exaix/core";
import { ActivityActor } from "@exaix/core";
import type { JSONValue } from "@exaix/core";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration for the FlowReporter
 */
export interface IFlowReportConfig {
  /** Directory where reports are written (now Memory/Execution/) */
  reportsDirectory: string;

  /** Database service for activity logging */
  db?: DatabaseService;
}

/**
 * Result of flow report generation
 */
export interface FlowReportResult {
  /** Absolute path to the generated report */
  reportPath: string;

  /** Generated report content */
  content: string;

  /** Timestamp when report was created */
  createdAt: Date;
}

// ============================================================================
// FlowReporter Implementation
// ============================================================================

export class FlowReporter {
  private config: Config;
  private reportConfig: IFlowReportConfig;

  constructor(config: Config, reportConfig: IFlowReportConfig) {
    this.config = config;
    this.reportConfig = reportConfig;
  }

  /**
   * Generate a flow report for a completed flow execution
   */
  async generate(
    flow: IFlow,
    flowResult: IFlowResult,
    requestId?: string,
  ): Promise<FlowReportResult> {
    const startTime = Date.now();

    try {
      // Build the report content
      const content = await this.buildReport(flow, flowResult, requestId);

      // Generate filename: flow_{flowId}_{runId}_{timestamp}.md
      const filename = this.generateFilename(flow, flowResult);
      const reportPath = join(this.reportConfig.reportsDirectory, filename);

      // Write report to file
      await Deno.writeTextFile(reportPath, content);

      const createdAt = new Date();

      // Log success to IActivity Journal
      this.logReportGenerated(flow, flowResult, reportPath, Date.now() - startTime);

      return {
        reportPath,
        content,
        createdAt,
      };
    } catch (error) {
      // Log failure to IActivity Journal
      this.logReportFailed(flow, flowResult, error as Error, Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Build the complete report content
   */
  private async buildReport(
    flow: IFlow,
    flowResult: IFlowResult,
    requestId?: string,
  ): Promise<string> {
    const sections: string[] = [];

    // 1. YAML Frontmatter
    sections.push(this.buildFrontmatter(flow, flowResult, requestId));

    // 2. Title
    sections.push(this.buildTitle(flow, flowResult));

    // 3. Execution Summary
    sections.push(this.buildExecutionSummary(flowResult));

    // 4. Step Outputs
    sections.push(this.buildStepOutputs(flowResult));

    // 5. Shared Namespace
    if (flowResult.namespaceArtifactPath) {
      sections.push(this.buildSharedNamespace(flowResult.namespaceArtifactPath));
    }

    // 6. Dependency Graph
    sections.push(this.buildDependencyGraph(flow));

    return await sections.join("\n");
  }

  /**
   * Generate YAML frontmatter for the flow report
   */
  private buildFrontmatter(
    flow: IFlow,
    flowResult: IFlowResult,
    requestId?: string,
  ): string {
    const completedAt = flowResult.completedAt.toISOString();
    const stepsCompleted = Array.from(flowResult.stepResults.values())
      .filter((step) => step.success).length;
    const stepsFailed = Array.from(flowResult.stepResults.values())
      .filter((step) => !step.success).length;

    const frontmatter: Record<string, JSONValue> = {
      type: "flow_report",
      flow: flow.id,
      flow_run_id: flowResult.flowRunId,
      duration_ms: flowResult.duration,
      steps_completed: stepsCompleted,
      steps_failed: stepsFailed,
      completed_at: completedAt,
      success: flowResult.success,
    };

    if (flowResult.tokenSummary) {
      frontmatter.input_tokens = flowResult.tokenSummary.input_tokens;
      frontmatter.output_tokens = flowResult.tokenSummary.output_tokens;
      frontmatter.total_tokens = flowResult.tokenSummary.total_tokens;
      if (flowResult.tokenSummary.token_provider) {
        frontmatter.token_provider = flowResult.tokenSummary.token_provider;
      }
      if (flowResult.tokenSummary.token_model) {
        frontmatter.token_model = flowResult.tokenSummary.token_model;
      }
      if (typeof flowResult.tokenSummary.token_cost_usd === "number") {
        frontmatter.token_cost_usd = flowResult.tokenSummary.token_cost_usd;
      }
    }

    if (requestId) {
      frontmatter.request_id = requestId;
    }

    if (flowResult.namespaceArtifactPath) {
      frontmatter.namespace_artifact_path = flowResult.namespaceArtifactPath;
    }

    // Convert to YAML format
    const yamlLines = Object.entries(frontmatter).map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}: "${value}"`;
      }
      return `${key}: ${value}`;
    });

    return `---\n${yamlLines.join("\n")}\n---\n\n`;
  }

  /**
   * Generate title for the flow report
   */
  private buildTitle(flow: IFlow, flowResult: IFlowResult): string {
    const status = flowResult.success ? `${ICON_SUCCESS} Success` : `${ICON_FAILURE} Failed`;
    return `# IFlow Report: ${flow.name} (${status})\n\n`;
  }

  /**
   * Build execution summary table
   */
  private buildExecutionSummary(flowResult: IFlowResult): string {
    const steps = Array.from(flowResult.stepResults.values());

    let summary = "## Execution Summary\n\n";
    summary += "| Step | Status | Duration | Started | Completed |\n";
    summary += "|------|--------|----------|---------|-----------|\n";

    for (const step of steps) {
      const status = step.success ? ICON_SUCCESS : ICON_FAILURE;
      const duration = `${step.duration}ms`;
      const started = step.startedAt.toLocaleTimeString();
      const completed = step.completedAt.toLocaleTimeString();

      summary += `| ${step.stepId} | ${status} | ${duration} | ${started} | ${completed} |\n`;
    }

    summary += `\n**Total Duration:** ${flowResult.duration}ms\n`;
    summary += `**Overall Status:** ${flowResult.success ? `${ICON_SUCCESS} Success` : `${ICON_FAILURE} Failed`}\n\n`;

    return summary;
  }

  /**
   * Build step outputs section
   */
  private buildStepOutputs(flowResult: IFlowResult): string {
    let outputs = "## Step Outputs\n\n";

    for (const [stepId, stepResult] of flowResult.stepResults) {
      outputs += `### ${stepId}\n\n`;

      if (stepResult.success && stepResult.result) {
        outputs += `**Status:** ${ICON_SUCCESS} Success\n`;
        outputs += `**Duration:** ${stepResult.duration}ms\n\n`;

        // Include agent response content
        if (stepResult.result.content) {
          outputs += `**Output:**\n\n${stepResult.result.content}\n\n`;
        }

        // Include any additional metadata
        if (stepResult.result.raw) {
          outputs += `**Raw Response:**\n\n\`\`\`\n${stepResult.result.raw}\n\`\`\`\n\n`;
        }
      } else {
        outputs += `**Status:** ${ICON_FAILURE} Failed\n`;
        outputs += `**Duration:** ${stepResult.duration}ms\n`;
        if (stepResult.error) {
          outputs += `**Error:** ${stepResult.error}\n`;
        }
        outputs += "\n";
      }
    }

    return outputs;
  }

  /**
   * Build shared namespace section
   */
  private buildSharedNamespace(namespaceArtifactPath: string): string {
    return `## Shared Namespace\n\n${namespaceArtifactPath}\n\n`;
  }

  /**
   * Build dependency graph visualization
   */
  private buildDependencyGraph(flow: IFlow): string {
    let graph = "## Dependency Graph\n\n";
    graph += "```mermaid\ngraph TD\n";

    // Add nodes for each step
    for (const step of flow.steps) {
      const stepName = step.id;
      const agent = step.identity;
      graph += `    ${stepName}["${stepName}<br/>(${agent})"]\n`;
    }

    // Add edges for dependencies
    for (const step of flow.steps) {
      if (step.dependsOn && step.dependsOn.length > 0) {
        for (const dep of step.dependsOn) {
          graph += `    ${dep} --> ${step.id}\n`;
        }
      }
    }

    graph += "```\n\n";

    // Add text description
    graph += "**IFlow Structure:**\n\n";
    for (const step of flow.steps) {
      const deps = step.dependsOn && step.dependsOn.length > 0
        ? ` (depends on: ${step.dependsOn.join(", ")})`
        : " (no dependencies)";
      graph += `- **${step.id}**: ${step.name}${deps}\n`;
    }

    graph += "\n";
    return graph;
  }

  /**
   * Generate filename for the flow report
   */
  private generateFilename(flow: IFlow, flowResult: IFlowResult): string {
    const timestamp = flowResult.completedAt.toISOString().replace(/[:.]/g, "-");
    const shortRunId = flowResult.flowRunId.slice(0, 8);
    return `flow_${flow.id}_${shortRunId}_${timestamp}.md`;
  }

  /**
   * Log successful report generation to IActivity Journal
   */
  private logReportGenerated(
    flow: IFlow,
    flowResult: IFlowResult,
    reportPath: string,
    duration: number,
  ): void {
    if (!this.reportConfig.db) return;

    const fileName = reportPath.split("/").pop() || reportPath;

    this.reportConfig.db.logActivity(
      ActivityActor.SYSTEM,
      "flow.report.generated",
      flow.id,
      {
        flow_run_id: flowResult.flowRunId,
        report_path: fileName,
        duration_ms: duration,
        steps_completed: Array.from(flowResult.stepResults.values()).filter((s) => s.success).length,
        steps_failed: Array.from(flowResult.stepResults.values()).filter((s) => !s.success).length,
        success: flowResult.success,
      },
    );
  }

  /**
   * Log failed report generation to IActivity Journal
   */
  private logReportFailed(
    flow: IFlow,
    flowResult: IFlowResult,
    error: Error,
    duration: number,
  ): void {
    if (!this.reportConfig.db) return;

    this.reportConfig.db.logActivity(
      ActivityActor.SYSTEM,
      "flow.report.failed",
      flow.id,
      {
        flow_run_id: flowResult.flowRunId,
        error: error.message,
        duration_ms: duration,
      },
    );
  }
}
