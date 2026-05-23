/**
 * @module FlowReporter
 * @path packages/flow-storage/src/reporter.ts
 * @description Generates comprehensive reports for flow executions, analyzing multi-agent orchestration results.
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { ICON_FAILURE, ICON_SUCCESS } from "@exaix/core";
import { ActivityActor } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { IAgentExecutionResult } from "@exaix/execution";

export interface IFlowResult {
  flowRunId: string;
  success: boolean;
  stepResults: Map<string, IStepResult>;
  output: string;
  duration: number;
  startedAt: Date;
  completedAt: Date;
  namespaceArtifactPath?: string;
  tokenSummary?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    token_provider?: string;
    token_model?: string;
    token_cost_usd?: number;
  };
}

export interface IStepResult {
  stepId: string;
  success: boolean;
  result?: IAgentExecutionResult;
  error?: string;
  duration: number;
  startedAt: Date;
  completedAt: Date;
}

export interface IFlowReportConfig {
  reportsDirectory: string;
  db?: DatabaseService;
}

export interface FlowReportResult {
  reportPath: string;
  content: string;
  createdAt: Date;
}

export class FlowReporter {
  private config: Config;
  private reportConfig: IFlowReportConfig;

  constructor(config: Config, reportConfig: IFlowReportConfig) {
    this.config = config;
    this.reportConfig = reportConfig;
  }

  async generate(
    flow: IFlow,
    flowResult: IFlowResult,
    requestId?: string,
  ): Promise<FlowReportResult> {
    const startTime = Date.now();

    try {
      const content = await this.buildReport(flow, flowResult, requestId);

      const filename = this.generateFilename(flow, flowResult);
      const reportPath = join(this.reportConfig.reportsDirectory, filename);

      await Deno.writeTextFile(reportPath, content);

      const createdAt = new Date();

      this.logReportGenerated(flow, flowResult, reportPath, Date.now() - startTime);

      return {
        reportPath,
        content,
        createdAt,
      };
    } catch (error) {
      this.logReportFailed(flow, flowResult, error as Error, Date.now() - startTime);
      throw error;
    }
  }

  private async buildReport(
    flow: IFlow,
    flowResult: IFlowResult,
    requestId?: string,
  ): Promise<string> {
    const sections: string[] = [];

    sections.push(this.buildFrontmatter(flow, flowResult, requestId));
    sections.push(this.buildTitle(flow, flowResult));
    sections.push(this.buildExecutionSummary(flowResult));
    sections.push(this.buildStepOutputs(flowResult));

    if (flowResult.namespaceArtifactPath) {
      sections.push(this.buildSharedNamespace(flowResult.namespaceArtifactPath));
    }

    sections.push(this.buildDependencyGraph(flow));

    return await sections.join("\n");
  }

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

    const yamlLines = Object.entries(frontmatter).map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}: "${value}"`;
      }
      return `${key}: ${value}`;
    });

    return `---\n${yamlLines.join("\n")}\n---\n\n`;
  }

  private buildTitle(flow: IFlow, flowResult: IFlowResult): string {
    const status = flowResult.success ? `${ICON_SUCCESS} Success` : `${ICON_FAILURE} Failed`;
    return `# IFlow Report: ${flow.name} (${status})\n\n`;
  }

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

  private buildStepOutputs(flowResult: IFlowResult): string {
    let outputs = "## Step Outputs\n\n";

    for (const [stepId, stepResult] of flowResult.stepResults) {
      outputs += `### ${stepId}\n\n`;

      if (stepResult.success && stepResult.result) {
        outputs += `**Status:** ${ICON_SUCCESS} Success\n`;
        outputs += `**Duration:** ${stepResult.duration}ms\n\n`;

        if (stepResult.result.content) {
          outputs += `**Output:**\n\n${stepResult.result.content}\n\n`;
        }

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

  private buildSharedNamespace(namespaceArtifactPath: string): string {
    return `## Shared Namespace\n\n${namespaceArtifactPath}\n\n`;
  }

  private buildDependencyGraph(flow: IFlow): string {
    let graph = "## Dependency Graph\n\n";
    graph += "```mermaid\ngraph TD\n";

    for (const step of flow.steps) {
      const stepName = step.id;
      const agent = step.identity;
      graph += `    ${stepName}["${stepName}<br/>(${agent})"]\n`;
    }

    for (const step of flow.steps) {
      if (step.dependsOn && step.dependsOn.length > 0) {
        for (const dep of step.dependsOn) {
          graph += `    ${dep} --> ${step.id}\n`;
        }
      }
    }

    graph += "```\n\n";

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

  private generateFilename(flow: IFlow, flowResult: IFlowResult): string {
    const timestamp = flowResult.completedAt.toISOString().replace(/[:.]/g, "-");
    const shortRunId = flowResult.flowRunId.slice(0, 8);
    return `flow_${flow.id}_${shortRunId}_${timestamp}.md`;
  }

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
