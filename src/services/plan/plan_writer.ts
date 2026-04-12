/**
 * @module PlanWriter
 * @path src/services/plan/plan_writer.ts
 * @description Formats agent execution results into structured plans.
 *
 * Notes:
 * - LLMs now output JSON plans within <content> tags
 * - PlanAdapter validates JSON against schema
 * - Converts validated plan to markdown for storage
 *
 * @architectural-layer Services
 * * @related-files [src/services/plan_adapter.ts, src/services/request_processor.ts]
 */

import { ACTIVITY_ACTOR_AGENT, DEFAULT_COST_PRECISION_FACTOR } from "../../shared/constants.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import type { DatabaseService } from "../core/db.ts";
import { PlanAdapter, PlanValidationError } from "./plan_adapter.ts";
import type { PlanFrontmatter } from "../../shared/schemas/plan_schema.ts";
import { PlanStatus } from "../../shared/status/plan_status.ts";
import { MiddlewarePipeline } from "../middleware/pipeline.ts";
import type { IServiceContext } from "../common/types.ts";
import type { JSONValue } from "../../shared/types/json.ts";
import type { IRequestAnalysis } from "../../shared/schemas/request_analysis.ts";

export interface IRequestMetadata {
  requestId: string;
  identityId?: string;
  traceId: string;
  createdAt: Date;
  contextFiles: string[];
  contextWarnings: string[];
  model?: string;
  portal?: string;
  targetBranch?: string;
  subject?: string;
  subjectIsFallback?: boolean;
  requestAnalysis?: IRequestAnalysis;
}

export interface IPlanWriterConfig {
  plansDirectory: string;
  includeReasoning: boolean;
  generateWikiLinks: boolean;
  runtimeRoot: string;
  db?: DatabaseService;
}

export interface IPlanWriteResult {
  planPath: string;
  content: string;
  writtenAt: Date;
  subject?: string;
}

export interface IAgentExecutionResult {
  thought: string;
  content: string;
  raw: string;
}

export interface ITokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider?: string;
  model?: string;
  costUsd?: number;
}

// ============================================================================
// Plan Writer Service
// ============================================================================

/**
 * PlanWriter formats agent execution results into structured markdown plans
 * and writes them to Workspace/Plans for user review
 */
export class PlanWriter {
  private adapter: PlanAdapter;

  constructor(private config: IPlanWriterConfig) {
    this.adapter = new PlanAdapter();
  }

  /**
   * Write a plan document based on agent execution result
   */
  async writePlan(
    result: IAgentExecutionResult,
    metadata: IRequestMetadata,
  ): Promise<IPlanWriteResult> {
    // Execute writePlan through middleware pipeline to centralize timing/logging
    interface IPlanWriterContext extends IServiceContext {
      requestId?: string;
      __startTime?: number;
      __durationMs?: number;
    }
    const pipeline = new MiddlewarePipeline<IPlanWriterContext>();

    // Timing middleware
    pipeline.use(async (_ctx, next) => {
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      _ctx.__startTime = start;
      await next();
      const end = typeof performance !== "undefined" ? performance.now() : Date.now();
      _ctx.__durationMs = end - _ctx.__startTime;
    });

    // Error handling / logging middleware
    pipeline.use(async (_ctx, next) => {
      try {
        await next();
      } catch (err) {
        // Bubble up after optional instrumentation
        throw err;
      }
    });

    const context: IPlanWriterContext = { traceId: metadata.traceId, requestId: metadata.requestId };

    let writeResult: IPlanWriteResult;

    await pipeline.execute(context, async () => {
      // Generate plan content (with JSON validation)
      const { content, subject } = await this.formatPlan(result, metadata);

      // Generate filename: request-id_plan.md
      const filename = this.generateFilename(metadata.requestId);
      const planPath = `${this.config.plansDirectory}/${filename}`;

      // Write to file
      await Deno.writeTextFile(planPath, content);

      const writtenAt = new Date();

      // Log to IActivity Journal
      await this.logPlanCreation(planPath, metadata.traceId, metadata);

      writeResult = {
        planPath,
        content,
        writtenAt,
        subject,
      };
    });

    return writeResult!;
  }

  /**
   * Format the complete plan document
   * Step 6.7: Validates JSON plan and converts to markdown
   */
  private async formatPlan(
    result: IAgentExecutionResult,
    metadata: IRequestMetadata,
  ): Promise<{ content: string; subject?: string }> {
    const sections: string[] = [];

    // 2. Validate and convert JSON plan to markdown
    let planMarkdown: string;
    let agentSubject: string | undefined;
    try {
      const plan = this.adapter.parse(result.content);
      planMarkdown = this.adapter.toMarkdown(plan);
      agentSubject = plan.subject;

      // Log validation success
      await this.logPlanValidation(
        "plan.validation.success",
        metadata.requestId,
        metadata.traceId,
        {
          step_count: plan.steps?.length ?? 0,
          has_risks: plan.risks !== undefined && plan.risks.length > 0,
          has_dependencies: plan.steps?.some((s) => s.dependencies && s.dependencies.length > 0) ?? false,
        },
      );
    } catch (error) {
      if (error instanceof PlanValidationError) {
        // Log validation failure
        await this.logPlanValidation(
          "plan.validation.failed",
          metadata.requestId,
          metadata.traceId,
          {
            error_type: "PlanValidationError",
            error_message: error.message,
            raw_preview: result.content.substring(0, 200),
          },
        );
        // Enrich error details with full raw response for debugging
        error.details.fullRawResponse = result.raw;
        await this.logPlanValidation(
          "plan.validation.enriched",
          metadata.requestId,
          metadata.traceId,
          { raw_length: result.raw.length },
        );
        throw error;
      }
      throw error;
    }

    // 1. Frontmatter (now potentially with upgraded subject)
    const tokenSummary = await this.getTokenUsageSummary(metadata.traceId);

    // Priority: Explicit user subject > Agent subject > Fallback subject
    // We treat metadata.subject as "explicit" unless subjectIsFallback is true
    const finalSubject = (metadata.subjectIsFallback && agentSubject)
      ? agentSubject
      : (metadata.subject || agentSubject);
    sections.push(this.generateFrontmatter({ ...metadata, subject: finalSubject }, tokenSummary));

    // Log successful parsing
    await this.logPlanValidation(
      "plan.parsed",
      metadata.requestId,
      metadata.traceId,
      { file_path: `${this.config.plansDirectory}/${this.generateFilename(metadata.requestId)}` },
    );

    // 3. Reasoning (from thought tags)
    if (this.config.includeReasoning && result.thought) {
      sections.push(`## Reasoning\n`);
      sections.push(result.thought);
      sections.push("");
    }

    // 4. Plan content (converted from JSON)
    sections.push(planMarkdown);
    sections.push("");

    // 6. Context References
    if (metadata.contextFiles.length > 0) {
      sections.push(this.generateContextReferences(metadata));
    }

    // 7. Next Steps
    sections.push(this.generateNextSteps(metadata.requestId));

    return {
      content: sections.join("\n"),
      subject: finalSubject,
    };
  }

  /**
   * Generate YAML frontmatter
   */
  private generateFrontmatter(metadata: IRequestMetadata, tokenSummary?: ITokenUsageSummary | null): string {
    const frontmatter: PlanFrontmatter = {
      trace_id: metadata.traceId,
      request_id: metadata.requestId,
      status: PlanStatus.REVIEW,
      created_at: metadata.createdAt.toISOString(),
    };

    if (metadata.identityId) {
      frontmatter.identity_id = metadata.identityId;
    }

    if (metadata.model) {
      frontmatter.model = metadata.model;
    }

    if (metadata.portal) {
      frontmatter.portal = metadata.portal;
    }

    if (metadata.targetBranch) {
      frontmatter.target_branch = metadata.targetBranch;
    }

    if (metadata.subject) {
      frontmatter.subject = metadata.subject;
    }

    if (metadata.requestAnalysis) {
      frontmatter.request_analysis = metadata.requestAnalysis;
    }

    if (tokenSummary) {
      frontmatter.input_tokens = tokenSummary.inputTokens;
      frontmatter.output_tokens = tokenSummary.outputTokens;
      frontmatter.total_tokens = tokenSummary.totalTokens;
      if (tokenSummary.provider) {
        frontmatter.token_provider = tokenSummary.provider;
      }
      if (tokenSummary.model) {
        frontmatter.token_model = tokenSummary.model;
      }
      if (typeof tokenSummary.costUsd === "number") {
        frontmatter.token_cost_usd = tokenSummary.costUsd;
      }
    }

    const yamlContent = stringifyYaml(frontmatter);
    return `---\n${yamlContent}---\n\n`;
  }

  private async getTokenUsageSummary(traceId: string): Promise<ITokenUsageSummary | null> {
    if (!this.config.db) {
      return null;
    }

    const events = await this.config.db.queryActivity({ traceId, actionType: "llm.usage" });
    if (events.length === 0) {
      return null;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    const providers = new Set<string>();
    const models = new Set<string>();

    for (const event of events) {
      try {
        const payload = JSON.parse(event.payload) as Record<string, JSONValue>;
        const input = Number(payload.input_tokens ?? payload.prompt_tokens ?? 0);
        const output = Number(payload.output_tokens ?? payload.completion_tokens ?? 0);
        const total = Number(payload.total_tokens ?? input + output);
        const provider = (payload.provider ?? event.target) as string | undefined;
        const model = payload.model as string | undefined;
        const cost = Number(payload.cost_usd ?? 0);

        inputTokens += input;
        outputTokens += output;
        totalTokens += total;
        costUsd += cost;

        if (provider) {
          providers.add(provider);
        }
        if (model) {
          models.add(model);
        }
      } catch {
        // Skip malformed token records
      }
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      provider: providers.size > 0 ? Array.from(providers).join(", ") : undefined,
      model: models.size > 0 ? Array.from(models).join(", ") : undefined,
      costUsd: Math.round(costUsd * DEFAULT_COST_PRECISION_FACTOR) / DEFAULT_COST_PRECISION_FACTOR,
    };
  }

  /**
   * Generate context references section with wiki links
   */
  private generateContextReferences(metadata: IRequestMetadata): string {
    const lines: string[] = [
      "## Context References\n",
      "This plan was based on the following context:\n",
    ];

    // Generate wiki links for context files
    if (this.config.generateWikiLinks) {
      const wikiLinks = this.generateWikiLinks(metadata.contextFiles);
      lines.push(...wikiLinks.map((link) => `- ${link}`));
    } else {
      lines.push(...metadata.contextFiles.map((file) => `- ${file}`));
    }

    // Add warnings if any
    if (metadata.contextWarnings.length > 0) {
      lines.push("\n**Context Warnings:**");
      lines.push(...metadata.contextWarnings.map((w) => `- ${w}`));
    }

    lines.push("");
    return lines.join("\n");
  }

  /**
   * Generate wiki links from file paths
   */
  private generateWikiLinks(filePaths: string[]): string[] {
    return filePaths.map((path) => {
      // Extract filename without extension for simple link
      const filename = path.split("/").pop()?.replace(/\.md$/, "") || path;

      // Return wiki link format [[filename]]
      return `[[${filename}]]`;
    });
  }

  /**
   * Generate filename for plan: requestId_plan.md
   */
  private generateFilename(requestId: string): string {
    return `${requestId}_plan.md`;
  }

  /**
   * Extract title from content (first # heading)
   */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : null;
  }

  /**
   * Extract summary (first paragraph or generate from title)
   */
  private extractSummary(content: string): string {
    // Find first paragraph after any headings
    const lines = content.split("\n");
    let inParagraph = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("#")) {
        inParagraph = false;
        continue;
      }

      if (line.trim() && !inParagraph) {
        inParagraph = true;
      }

      if (inParagraph) {
        if (!line.trim()) {
          break; // End of paragraph
        }
        paragraphLines.push(line);
      }
    }

    return paragraphLines.length > 0
      ? paragraphLines.join("\n")
      : "Generated implementation plan based on request analysis.";
  }

  /**
   * Generate next steps section
   */
  private generateNextSteps(requestId: string): string {
    return [
      "## Next Steps\n",
      "1. Review this plan for correctness and completeness",
      `2. If approved, move to \`Workspace/Active/${requestId}.md\``,
      "3. Agent will execute changes on a separate git branch",
      "4. Review the pull request before merging to main\n",
    ].join("\n");
  }

  /**
   * Log plan validation events to IActivity Journal
   */
  private async logPlanValidation(
    actionType: string,
    requestId: string,
    traceId: string,
    metadata: Record<string, JSONValue>,
  ): Promise<void> {
    if (!this.config.db) {
      // If no database provided, skip logging (testing mode)
      return;
    }

    try {
      await this.config.db.logActivity(
        ACTIVITY_ACTOR_AGENT,
        actionType,
        requestId,
        metadata,
        traceId,
      );
    } catch (error) {
      // Log to stderr but don't fail validation
      console.error(`[IActivity] Failed to log ${actionType}:`, error);
    }
  }

  /**
   * Log plan creation to IActivity Journal
   */
  private async logPlanCreation(
    planPath: string,
    traceId: string,
    metadata: IRequestMetadata,
  ): Promise<void> {
    if (!this.config.db) {
      // If no database provided, skip logging (testing mode)
      return;
    }

    try {
      await this.config.db.logActivity(
        ACTIVITY_ACTOR_AGENT,
        "plan.created",
        metadata.requestId,
        {
          plan_path: planPath,
          request_id: metadata.requestId,
          context_files_count: metadata.contextFiles.length,
          context_warnings_count: metadata.contextWarnings.length,
          has_reasoning: this.config.includeReasoning,
        },
        traceId,
      );
    } catch (error) {
      // Log to stderr but don't fail plan creation
      console.error("[IActivity] Failed to log plan.created:", error);
    }
  }
}
