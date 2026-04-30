/**
 * @module PlanCommands
 * @path src/cli/commands/plan_commands.ts
 * @description Provides CLI commands for human review of AI-generated plans, including approval, rejection, and revision requests.
 * @architectural-layer CLI
 * @related-files ["packages/schemas/src/plan_schema.ts", "src/main.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { FrontmatterParser } from "@exaix/parsing";
import { BaseCommand, type ICommandContext } from "../base.ts";
import { PlanStatus, type PlanStatusType, RequestStatus } from "@exaix/core";
import { RequestCommands } from "./request_commands.ts";
import { ValidationChain } from "../validation/validation_chain.ts";
import { DefaultErrorStrategy } from "../errors/error_strategy.ts";
import { CommandUtils } from "../helpers/command_utils.ts";
import { enrichWithRequest } from "../helpers/request_enricher.ts";
import {
  AMENDMENT_ARTIFACTS_DIR,
  PLAN_AMENDMENT_EVENT_APPLIED,
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_REJECTED,
  PLAN_REVIEW_COMMENT_PREFIX,
  PLAN_REVIEW_COMMENTS_HEADER,
  REQUEST_REVISION_COMMENT_PREFIX,
  REQUEST_REVISION_COMMENTS_HEADER,
} from "@exaix/core";
import { type IPlanAmendmentPatch, ZPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";

import { type PlanFrontmatter, PlanFrontmatterSchema } from "@exaix/schemas/plan_schema.ts";
import type { JSONValue } from "@exaix/core";

import type { IPlanDetails, IPlanMetadata } from "@exaix/core/types/plan.ts";

const FIELD_PLAN_ID = "planId";

/**
 * Extract plan metadata from parsed frontmatter
 */
function extractPlanMetadata(planId: string, frontmatter: PlanFrontmatter): IPlanMetadata {
  const validated = PlanFrontmatterSchema.parse(frontmatter);

  return {
    id: planId,
    status: validated.status || PlanStatus.REVIEW,
    trace_id: validated.trace_id as string | undefined,
    identity_id: validated.identity_id as string | undefined,
    request_id: validated.request_id as string | undefined,
    created_at: validated.created_at as string | undefined,
    input_tokens: validated.input_tokens?.toString(),
    output_tokens: validated.output_tokens?.toString(),
    total_tokens: validated.total_tokens?.toString(),
    token_provider: validated.token_provider as string | undefined,
    token_model: validated.token_model as string | undefined,
    token_cost_usd: validated.token_cost_usd?.toString(),
    approved_by: validated.approved_by as string | undefined,
    approved_at: validated.approved_at as string | undefined,
    rejected_by: validated.rejected_by as string | undefined,
    rejected_at: validated.rejected_at as string | undefined,
    rejection_reason: validated.rejection_reason as string | undefined,
    reviewed_by: validated.reviewed_by as string | undefined,
    reviewed_at: validated.reviewed_at as string | undefined,
    subject: validated.subject as string | undefined,
  };
}

/**
 * PlanCommands provides CLI operations for human review of AI-generated plans.
 * All operations are atomic and logged to activity_log with actor='human'.
 */
export class PlanCommands extends BaseCommand {
  private workspacePlansDir: string;
  private workspaceActiveDir: string;
  private workspaceRequestsDir: string;
  private workspaceRejectedDir: string;
  private workspaceArchiveDir: string;
  private parser: FrontmatterParser;
  private requestCommands: RequestCommands;

  constructor(
    context: ICommandContext,
  ) {
    super(context);
    const config = context.config.getAll();
    const root = config.system.root!;
    const workspace = config.paths.workspace!;
    // Resolve paths relative to system root and workspace
    this.workspacePlansDir = join(root, workspace, config.paths.plans!);
    this.workspaceActiveDir = join(root, workspace, config.paths.active!);
    this.workspaceRejectedDir = join(root, workspace, config.paths.rejected!);
    this.workspaceArchiveDir = join(root, workspace, config.paths.archive!);
    this.workspaceRequestsDir = join(root, workspace, config.paths.requests!);
    this.parser = new FrontmatterParser();
    this.requestCommands = new RequestCommands(context);
  }

  /**
   * Extract plan metadata from parsed frontmatter, including request information
   */
  private async extractPlanMetadataWithRequest(
    planId: string,
    frontmatter: PlanFrontmatter,
  ): Promise<IPlanMetadata> {
    const metadata = extractPlanMetadata(planId, frontmatter);
    return await enrichWithRequest(this.requestCommands, metadata, `plan ${planId}`);
  }

  /**
   * Approve a plan: move from Workspace/Plans to Workspace/Active
   * Only plans with status='review' can be approved.
   */
  async approve(planId: string, skills?: string[]): Promise<void> {
    try {
      // Validate input
      const validation = new ValidationChain()
        .addRule(FIELD_PLAN_ID, ValidationChain.required())
        .addRule(FIELD_PLAN_ID, ValidationChain.isString())
        .validate({ planId });

      if (!validation.isValid) {
        throw new Error(CommandUtils.formatValidationErrors(validation));
      }

      const sourcePath = join(this.workspacePlansDir, `${planId}.md`);
      const targetPath = join(this.workspaceActiveDir, `${planId}.md`);

      // Load and parse plan
      const { frontmatter, body } = await this.loadPlan(sourcePath);

      // Validate status
      if (frontmatter.status !== PlanStatus.REVIEW) {
        throw new Error(
          `Only plans with status='review' can be approved. Current status: ${frontmatter.status}`,
        );
      }

      // Validate target path doesn't exist, or archive existing plan
      if (await exists(targetPath)) {
        // Archive existing plan
        await ensureDir(this.workspaceArchiveDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const archivePath = join(this.workspaceArchiveDir, `${planId}_archived_${timestamp}.md`);
        await Deno.rename(targetPath, archivePath);
      }

      // Get user context
      const { actor, now } = await this.getUserContext();

      // Update frontmatter
      const updatedFrontmatter: PlanFrontmatter = {
        ...frontmatter,
        status: PlanStatus.APPROVED,
        approved_by: actor,
        approved_at: now,
      };

      // Add skills if provided
      if (skills && skills.length > 0) {
        updatedFrontmatter.skills = skills;
      }

      // Write updated plan to target
      await ensureDir(this.workspaceActiveDir);
      const updatedContent = this.serializePlan(updatedFrontmatter, body);
      await Deno.writeTextFile(targetPath, updatedContent);

      // Remove original (atomic operation complete)
      await Deno.remove(sourcePath);

      // Log activity with user identity
      await this.display.info("plan.approved", planId, {
        approved_at: now,
        via: "cli",
        command: this.getCommandLineString(),
      }, frontmatter.trace_id as string | undefined);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.approve",
        args: { planId, skills },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Approve all plans awaiting review.
   */
  async approveAll(skills?: string[]): Promise<void> {
    try {
      const plans = await this.list(PlanStatus.REVIEW);
      if (plans.length === 0) {
        await this.display.info("plan.approve_all", "none", { message: "No plans found with status='review'" });
        return;
      }

      await this.display.info("plan.approve_all", "starting", { count: plans.length });
      for (const plan of plans) {
        await this.approve(plan.id, skills);
      }
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.approveAll",
        args: { skills },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Reject a plan: move from any directory to Workspace/Rejected with _rejected.md suffix
   * Requires a rejection reason.
   */
  async reject(planId: string, reason: string): Promise<void> {
    try {
      // Validate input
      const validation = new ValidationChain()
        .addRule(FIELD_PLAN_ID, ValidationChain.required())
        .addRule("reason", ValidationChain.required())
        .validate({ planId, reason });

      if (!validation.isValid) {
        throw new Error(CommandUtils.formatValidationErrors(validation));
      }

      // Find the plan in any directory (like show method does)
      const searchPaths = [
        { path: join(this.workspacePlansDir, `${planId}.md`), sourceDir: this.workspacePlansDir },
        { path: join(this.workspaceRejectedDir, `${planId}_rejected.md`), sourceDir: this.workspaceRejectedDir },
        { path: join(this.workspaceActiveDir, `${planId}.md`), sourceDir: this.workspaceActiveDir },
        { path: join(this.workspaceArchiveDir, `${planId}.md`), sourceDir: this.workspaceArchiveDir },
      ];

      let sourcePath: string | null = null;
      let frontmatter: PlanFrontmatter | null = null;
      let body: string | null = null;

      for (const { path: planPath } of searchPaths) {
        if (await exists(planPath)) {
          const { frontmatter: fm, body: b } = await this.loadPlan(planPath);
          sourcePath = planPath;
          frontmatter = fm;
          body = b;
          break;
        }
      }

      if (!sourcePath || !frontmatter || !body) {
        throw new Error(`Plan not found: ${planId}`);
      }

      const targetPath = join(this.workspaceRejectedDir, `${planId}_rejected.md`);

      // Get user context
      const { actor, now } = await this.getUserContext();

      // Update frontmatter
      const updatedFrontmatter = {
        ...frontmatter,
        status: PlanStatus.REJECTED,
        rejected_by: actor,
        rejected_at: now,
        rejection_reason: reason,
      };

      // Write updated plan to target
      await ensureDir(this.workspaceRejectedDir);
      const updatedContent = this.serializePlan(updatedFrontmatter, body);
      await Deno.writeTextFile(targetPath, updatedContent);

      // Remove original (atomic operation complete)
      await Deno.remove(sourcePath);

      // Try to update the associated request with rejected_path for discoverability
      try {
        const rejectedRelative = join(this.config.paths.workspace, this.config.paths.rejected, `${planId}_rejected.md`);
        await this.updateRequestForRejection(
          frontmatter.request_id as string | undefined,
          rejectedRelative,
        );
      } catch (err) {
        // Non-fatal: log and continue
        console.warn("Warning: could not update request with rejected_path:", err);
      }

      // Log activity with user identity
      await this.display.info("plan.rejected", planId, {
        reason: reason,
        rejected_at: now,
        via: "cli",
        command: this.getCommandLineString(),
      }, frontmatter.trace_id as string | undefined);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.reject",
        args: { planId, reason },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  private async updateRequestForRejection(
    requestId: string | undefined,
    rejectedPath: string,
  ): Promise<void> {
    if (!requestId) return;

    try {
      const requestPath = join(this.workspaceRequestsDir, `${requestId}.md`);
      if (!await exists(requestPath)) return;

      const requestContent = await Deno.readTextFile(requestPath);
      const { frontmatter, body } = this.extractFrontmatterWithBody(requestContent);

      const updatedFrontmatter = {
        ...frontmatter,
        status: RequestStatus.PENDING,
        rejected_path: rejectedPath,
      };

      const updatedContent = this.serializePlan(updatedFrontmatter, body);
      await Deno.writeTextFile(requestPath, updatedContent);

      await this.display.info("request.rejected_linked", requestPath, {
        request_id: requestId,
        rejected_path: rejectedPath,
        via: "cli",
      }, frontmatter.trace_id as string | undefined);
    } catch (error) {
      await this.display.warn("request.rejection_update_failed", requestId, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Request revision: append review comments to plan and update status to 'needs_revision'
   * Plan remains in Workspace/Plans for the agent to address.
   */
  async revise(planId: string, comments: string[]): Promise<void> {
    try {
      // Validate input
      const validation = new ValidationChain()
        .addRule(FIELD_PLAN_ID, ValidationChain.required())
        .addRule(
          "comments",
          (val) => (!Array.isArray(val) || val.length === 0) ? "at least one comment is required" : null,
        )
        .validate({ planId, comments });

      if (!validation.isValid) {
        throw new Error(CommandUtils.formatValidationErrors(validation));
      }

      const planPath = join(this.workspacePlansDir, `${planId}.md`);

      // Load and parse plan
      const { frontmatter, body } = await this.loadPlan(planPath);

      // Get user context
      const { actor, now } = await this.getUserContext();

      // Update frontmatter
      const updatedFrontmatter = {
        ...frontmatter,
        status: PlanStatus.NEEDS_REVISION,
        reviewed_by: actor,
        reviewed_at: now,
      };

      // Append comments to body
      let updatedBody = body;
      const reviewCommentsMarker = PLAN_REVIEW_COMMENTS_HEADER;

      // Check if review comments section exists
      if (updatedBody.includes(reviewCommentsMarker)) {
        // Append to existing section
        const formattedComments = comments.map((c) => `${PLAN_REVIEW_COMMENT_PREFIX}${c}`).join("\n");
        updatedBody = updatedBody.replace(
          reviewCommentsMarker,
          `${reviewCommentsMarker}\n\n${formattedComments}`,
        );
      } else {
        // Add new section at the end
        const formattedComments = comments.map((c) => `${PLAN_REVIEW_COMMENT_PREFIX}${c}`).join("\n");
        updatedBody = `${updatedBody.trim()}\n\n${reviewCommentsMarker}\n\n${formattedComments}\n`;
      }

      // Write updated plan
      const updatedContent = this.serializePlan(updatedFrontmatter, updatedBody);
      await Deno.writeTextFile(planPath, updatedContent);

      await this.updateRequestForRevision(frontmatter.request_id as string | undefined, comments);

      // Log activity with user identity
      await this.display.info("plan.revision_requested", planId, {
        comment_count: comments.length,
        reviewed_at: now,
        via: "cli",
        command: this.getCommandLineString(),
      }, frontmatter.trace_id as string | undefined);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.revise",
        args: { planId, comments },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  private async updateRequestForRevision(
    requestId: string | undefined,
    comments: string[],
  ): Promise<void> {
    if (!requestId) return;

    try {
      const requestPath = join(this.workspaceRequestsDir, `${requestId}.md`);
      if (!await exists(requestPath)) {
        throw new Error(`Request not found: ${requestId}`);
      }
      const requestContent = await Deno.readTextFile(requestPath);
      const { frontmatter, body } = this.extractFrontmatterWithBody(requestContent);

      const updatedFrontmatter = {
        ...frontmatter,
        status: RequestStatus.PENDING,
      };

      const updatedBody = this.appendRequestRevisionComments(body, comments);
      const updatedContent = this.serializePlan(updatedFrontmatter, updatedBody);
      await Deno.writeTextFile(requestPath, updatedContent);

      await this.display.info("request.revision_queued", requestPath, {
        request_id: requestId,
        comment_count: comments.length,
        via: "cli",
      }, frontmatter.trace_id as string | undefined);
    } catch (error) {
      await this.display.warn("request.revision_update_failed", requestId, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private appendRequestRevisionComments(body: string, comments: string[]): string {
    const revisionMarker = REQUEST_REVISION_COMMENTS_HEADER;
    const formattedComments = comments.map((c) => `${REQUEST_REVISION_COMMENT_PREFIX}${c}`).join("\n");

    if (body.includes(revisionMarker)) {
      return body.replace(
        revisionMarker,
        `${revisionMarker}\n\n${formattedComments}`,
      );
    }

    return `${body.trim()}\n\n${revisionMarker}\n\n${formattedComments}\n`;
  }

  /**
   * List all plans, optionally filtered by status.
   * Scans multiple directories based on status:
   * - Workspace/Plans: review, needs_revision, unknown
   * - Workspace/Active: approved (running)
   * - Workspace/Archive: approved (completed)
   * - Workspace/Rejected: rejected
   * - All directories when no filter is specified
   */
  async list(statusFilter?: PlanStatusType): Promise<IPlanMetadata[]> {
    const plans: IPlanMetadata[] = [];
    const dirsToScan = this.resolvePlanDirectories(statusFilter);

    for (const dir of dirsToScan) {
      try {
        // Ensure directory exists
        await ensureDir(dir);

        // Read directory
        for await (const entry of Deno.readDir(dir)) {
          if (!entry.isFile || !entry.name.endsWith(".md")) {
            continue;
          }

          const planId = entry.name.replace(/\.md$/, "").replace(/_rejected$/, "");
          const planPath = join(dir, entry.name);

          try {
            const content = await Deno.readTextFile(planPath);
            const { frontmatter } = this.extractFrontmatterWithBody(content);

            const metadata = await this.extractPlanMetadataWithRequest(planId, frontmatter);

            // Apply filter if specified (for edge cases where file is in wrong dir)
            if (!statusFilter || metadata.status === statusFilter) {
              plans.push(metadata);
            }
          } catch (error) {
            // Handle malformed files gracefully
            console.warn(`Warning: Could not parse plan ${planId}:`, error);
            if (!statusFilter) {
              plans.push({ id: planId, status: PlanStatus.REVIEW });
            }
          }
        }
      } catch (error) {
        // If directory doesn't exist, continue to next
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    }

    // Sort by ID for consistent ordering
    return plans.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Show details of a specific plan
   */
  async show(planId: string): Promise<IPlanDetails> {
    // Check multiple directories in order of likelihood:
    // 1. Workspace/Plans (review, needs_revision)
    // 2. Workspace/Rejected (rejected plans with _rejected suffix)
    // 3. Workspace/Active (approved/running)
    // 4. Workspace/Archive (approved/completed)

    const searchPaths = [
      { path: join(this.workspacePlansDir, `${planId}.md`) },
      { path: join(this.workspaceRejectedDir, `${planId}_rejected.md`) },
      { path: join(this.workspaceActiveDir, `${planId}.md`) },
      { path: join(this.workspaceArchiveDir, `${planId}.md`) },
    ];

    for (const { path: planPath } of searchPaths) {
      if (await exists(planPath)) {
        const content = await Deno.readTextFile(planPath);

        try {
          const { frontmatter, body } = this.extractFrontmatterWithBody(content);
          const metadata = await this.extractPlanMetadataWithRequest(planId, frontmatter);

          return {
            metadata,
            content: body,
          };
        } catch {
          // Handle plans without frontmatter
          return {
            metadata: {
              id: planId,
              status: PlanStatus.REVIEW,
            },
            content: content,
          };
        }
      }
    }

    // Plan not found in any directory
    throw new Error(`Plan not found: ${planId}`);
  }

  /**
   * Serialize frontmatter and body back to markdown format (YAML)
   */
  private serializePlan(frontmatter: PlanFrontmatter, body: string): string {
    const yamlContent = stringifyYaml(frontmatter as Record<string, JSONValue>);
    return `---\n${yamlContent}---\n\n${body}`;
  }

  /**
   * Extract frontmatter and body from markdown (YAML format)
   * Returns both frontmatter and body, unlike base class version
   */
  private extractFrontmatterWithBody(markdown: string): { frontmatter: PlanFrontmatter; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    const match = markdown.match(frontmatterRegex);

    if (!match) {
      throw new Error("No frontmatter found");
    }

    const yamlContent = match[1];
    const body = match[2] || "";

    try {
      const frontmatter = parseYaml(yamlContent) as PlanFrontmatter;
      return { frontmatter, body };
    } catch (error) {
      throw new Error(`Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load and parse a plan file
   * @private
   */
  private async loadPlan(planPath: string): Promise<{
    content: string;
    frontmatter: PlanFrontmatter;
    body: string;
  }> {
    if (!await exists(planPath)) {
      const planId = planPath.split("/").pop()?.replace(".md", "") || "unknown";
      throw new Error(`Plan not found: ${planId}`);
    }

    const content = await Deno.readTextFile(planPath);
    const { frontmatter, body } = this.extractFrontmatterWithBody(content);

    return { content, frontmatter, body };
  }

  /**
   * Get current user identity
   * @private
   */
  private async getUserContext(): Promise<{
    actor: string;
    now: string;
  }> {
    const actor = await this.getUserIdentity();
    const now = new Date().toISOString();

    return { actor, now };
  }

  /**
   * List all pending amendments
   */
  async listAmendments(): Promise<IPlanMetadata[]> {
    return await this.list(PlanStatus.AMENDMENT_PENDING);
  }

  /**
   * Get amendment details for a plan
   */
  async getAmendment(planId: string): Promise<IPlanAmendmentPatch> {
    const { metadata } = await this.show(planId);
    if (!metadata.trace_id) {
      throw new Error(`Plan ${planId} has no trace_id; cannot find amendment artifact.`);
    }

    // Load plan file content to find amendment_id in frontmatter
    const searchPaths = [
      join(this.workspaceActiveDir, `${planId}.md`),
      join(this.workspacePlansDir, `${planId}.md`),
    ];

    let planFile: { frontmatter: PlanFrontmatter } | null = null;
    for (const p of searchPaths) {
      if (await exists(p)) {
        planFile = await this.loadPlan(p);
        break;
      }
    }

    if (!planFile) {
      throw new Error(`Plan ${planId} not found in Workspace/Active or Workspace/Plans`);
    }

    const amendmentId = planFile.frontmatter.amendment_id;
    if (!amendmentId) {
      throw new Error(`Plan ${planId} has no amendment_id in frontmatter.`);
    }

    const config = this.context.config.getAll();
    const executionRoot = config.paths.memoryExecution.includes("/")
      ? config.paths.memoryExecution
      : join(config.paths.memory, config.paths.memoryExecution);

    const artifactPath = join(
      config.system.root,
      executionRoot,
      metadata.trace_id,
      AMENDMENT_ARTIFACTS_DIR,
      `${amendmentId}.json`,
    );

    if (!(await exists(artifactPath))) {
      throw new Error(`Amendment artifact not found: ${artifactPath}`);
    }

    const content = await Deno.readTextFile(artifactPath);
    const patch = JSON.parse(content);
    return ZPlanAmendmentPatch.parse(patch);
  }

  /**
   * Get all pending amendments with patches
   */
  async getAmendments(): Promise<{ id: string; patch: IPlanAmendmentPatch }[]> {
    const plans = await this.listAmendments();
    const results: { id: string; patch: IPlanAmendmentPatch }[] = [];

    for (const plan of plans) {
      try {
        const patch = await this.getAmendment(plan.id);
        results.push({ id: plan.id, patch });
      } catch (err) {
        console.warn(`Warning: Could not load amendment for ${plan.id}:`, err);
      }
    }

    return results;
  }

  /**
   * Approve an amendment and resume execution
   */
  async approveAmendment(planId: string): Promise<void> {
    try {
      const patch = await this.getAmendment(planId);
      const planPath = join(this.workspaceActiveDir, `${planId}.md`);
      const { content, frontmatter } = await this.loadPlan(planPath);

      if (!this.context.amendments) {
        throw new Error("Amendment service not available in context.");
      }

      // Apply patch via service (updates steps and status in markdown)
      const appliedContent = this.context.amendments.applyApprovedAmendment(content, patch);

      // Re-parse to get updated frontmatter/body
      const { frontmatter: updatedFm, body: updatedBody } = this.extractFrontmatterWithBody(appliedContent);

      // Final polish: update reviewer metadata and clear amendment fields
      const { actor, now } = await this.getUserContext();
      const finalFm: Record<string, JSONValue> = {
        ...updatedFm,
        approved_by: actor,
        approved_at: now,
      };
      // Clear amendment tracking fields
      delete finalFm.amendment_id;
      delete finalFm.amendment_proposed_at;

      const updatedContent = this.serializePlan(finalFm as PlanFrontmatter, updatedBody);
      await Deno.writeTextFile(planPath, updatedContent);

      // Log activity
      await this.display.info(PLAN_AMENDMENT_EVENT_APPROVED, planId, {
        amendmentId: patch.amendmentId,
        message: `Amendment approved and applied to ${planId}`,
        approved_at: now,
        approved_by: actor,
        trace_id: frontmatter.trace_id,
      });

      // Emit APPLIED event for resume tracking
      const appliedStepCount = patch.adds.length + patch.updates.length;
      await this.display.info(PLAN_AMENDMENT_EVENT_APPLIED, planId, {
        amendmentId: patch.amendmentId,
        planId,
        appliedStepCount,
      });

      console.log(`[PlanCommands] Amendment ${patch.amendmentId} approved and applied to ${planId}`);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.approveAmendment",
        args: { planId },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Reject an amendment and abort execution
   */
  async rejectAmendment(planId: string, reason: string): Promise<void> {
    try {
      // Rejection of amendment usually means aborting the plan entirely or reverting to previous state.
      // In Exaix, we move the plan to Rejected.
      await this.reject(planId, `Amendment Rejected: ${reason}`);

      const { actor, now } = await this.getUserContext();
      await this.display.info(PLAN_AMENDMENT_EVENT_REJECTED, planId, {
        rejected_at: now,
        rejected_by: actor,
        reason,
      });
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.rejectAmendment",
        args: { planId, reason },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Approve all pending amendments
   */
  async approveAllAmendments(): Promise<void> {
    try {
      const plans = await this.listAmendments();
      if (plans.length === 0) {
        await this.display.info("plan.amendment.approve_all", "none", { message: "No pending amendments found" });
        return;
      }

      await this.display.info("plan.amendment.approve_all", "starting", { count: plans.length });
      for (const plan of plans) {
        await this.approveAmendment(plan.id);
      }
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "PlanCommands.approveAllAmendments",
        args: {},
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Resolve which directories to scan based on status filter.
   */
  private resolvePlanDirectories(statusFilter?: PlanStatusType): string[] {
    if (!statusFilter) {
      return [
        this.workspacePlansDir,
        this.workspaceActiveDir,
        this.workspaceRejectedDir,
        this.workspaceArchiveDir,
      ];
    }

    if (
      statusFilter === PlanStatus.APPROVED ||
      statusFilter === PlanStatus.ACTIVE ||
      statusFilter === PlanStatus.AMENDMENT_PENDING
    ) {
      return [this.workspaceActiveDir, this.workspaceArchiveDir];
    }

    if (statusFilter === PlanStatus.REJECTED) {
      return [this.workspaceRejectedDir];
    }

    return [this.workspacePlansDir];
  }
}
