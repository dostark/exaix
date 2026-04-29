/**
 * @module ReviewRegistry
 * @path src/services/artifact/review_registry.ts
 * @description Manages the lifecycle of agent-created reviews, including registration,
 * status updates, and diff generation for approval workflows.
 * @architectural-layer Services
 * @related-files [src/services/execution_loop.ts, src/services/db.ts]
 */

import type { IDatabaseService, SqliteParam } from "../core/db.ts";
import type { EventLogger } from "../core/event_logger.ts";
import {
  type IRegisterReviewInput,
  type IReview,
  type IReviewFilters,
  RegisterReviewSchema,
  ReviewSchema,
} from "@exaix/schemas/review.ts";
import { type IReviewStatus, ReviewStatus } from "../../reviews/review_status.ts";
import { ACTIVITY_ACTOR_AGENT } from "@exaix/core";

export class ReviewRegistry {
  constructor(
    private db: IDatabaseService,
    private logger: EventLogger,
  ) {}

  /**
   * Register a new review created by an agent
   */
  async register(input: IRegisterReviewInput): Promise<string> {
    // Validate input
    const validated = RegisterReviewSchema.parse(input);

    // Generate UUID for review
    const id = crypto.randomUUID();
    const created = new Date().toISOString();
    const status = ReviewStatus.PENDING;

    // Insert into database
    const sql = `
      INSERT INTO reviews (
        id, trace_id, portal, branch, repository, base_branch, worktree_path, status, description,
        commit_sha, files_changed, created, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      await this.db.preparedRun(sql, [
        id,
        validated.trace_id,
        validated.portal ?? null,
        validated.branch,
        validated.repository,
        validated.base_branch || null,
        validated.worktree_path || null,
        status,
        validated.description,
        validated.commit_sha || null,
        validated.files_changed,
        created,
        validated.created_by,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const looksLikeOldSchema = message.includes("base_branch") || message.includes("worktree_path");
      if (!looksLikeOldSchema) throw error;

      // Legacy schema fallback: DB not migrated yet.
      const legacySql = `
        INSERT INTO reviews (
          id, trace_id, portal, branch, repository, status, description,
          commit_sha, files_changed, created, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.db.preparedRun(legacySql, [
        id,
        validated.trace_id,
        validated.portal ?? null,
        validated.branch,
        validated.repository,
        status,
        validated.description,
        validated.commit_sha || null,
        validated.files_changed,
        created,
        validated.created_by,
      ]);
    }

    // Log to IActivity Journal
    await this.logger.info("review.created", validated.branch, {
      review_id: id,
      trace_id: validated.trace_id,
      portal: validated.portal ?? null,
      branch: validated.branch,
      repository: validated.repository,
      base_branch: validated.base_branch ?? null,
      worktree_path: validated.worktree_path ?? null,
      created_by: validated.created_by,
      files_changed: validated.files_changed,
    }, validated.trace_id);

    return id;
  }

  /**
   * Create a new review with branch creation in specified repository
   * Higher-level API that combines branch creation and registration
   *
   * @param traceId - Trace ID for the review (must be valid UUID)
   * @param portal - Portal name (or null for workspace)
   * @param branch - Branch name (already created by GitService)
   * @param repository - Absolute path to git repository
   * @returns Review ID
   */
  async createReview(
    traceId: string,
    portal: string | null,
    branch: string,
    repository: string,
  ): Promise<string> {
    // Register review using the register method
    return await this.register({
      trace_id: traceId,
      portal: portal,
      branch,
      repository,
      description: `Review for ${branch}`,
      created_by: ACTIVITY_ACTOR_AGENT, // TODO: Get from execution context
      files_changed: 0,
    });
  }

  /**
   * Get diff for a review from its repository
   *
   * @param reviewId - Review ID
   * @returns Git diff output
   */
  async getDiff(reviewId: string): Promise<string> {
    const review = await this.get(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    // Use base_branch if available, otherwise use parent of feature branch
    const baseBranch = review.base_branch || `${review.branch}^`;

    // Get diff between base branch and feature branch
    const cmd = new Deno.Command("git", {
      args: ["diff", `${baseBranch}..${review.branch}`],
      cwd: review.repository,
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr, code } = await cmd.output();

    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Git diff failed: ${error}`);
    }

    return new TextDecoder().decode(stdout);
  }

  /**
   * Get review by ID
   */
  async get(id: string): Promise<IReview | null> {
    const sql = `SELECT * FROM reviews WHERE id = ?`;
    const row = await this.db.preparedGet(sql, [id]);

    if (!row) return null;
    return ReviewSchema.parse(row);
  }

  /**
   * Get review by branch name
   */
  async getByBranch(branch: string): Promise<IReview | null> {
    const sql = `SELECT * FROM reviews WHERE branch = ?`;
    const row = await this.db.preparedGet(sql, [branch]);
    if (!row) return null;
    return ReviewSchema.parse(row);
  }

  /**
   * List reviews with optional filters
   */
  async list(filters?: IReviewFilters): Promise<IReview[]> {
    let sql = `SELECT * FROM reviews WHERE 1=1`;
    const params: Array<string | number> = [];

    if (filters?.trace_id) {
      sql += ` AND trace_id = ?`;
      params.push(filters.trace_id);
    }

    if (filters?.portal) {
      sql += ` AND portal = ?`;
      params.push(filters.portal);
    }

    if (filters?.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters?.created_by) {
      sql += ` AND created_by = ?`;
      params.push(filters.created_by);
    }

    sql += ` ORDER BY created DESC`;

    const rows = await this.db.preparedAll<IReview>(sql, params as SqliteParam[]);
    return rows.map((row) => ReviewSchema.parse(row));
  }

  /**
   * Update review status
   */
  async updateStatus(
    id: string,
    status: IReviewStatus,
    user?: string,
    reason?: string,
  ): Promise<void> {
    // Get existing review
    const review = await this.get(id);
    if (!review) {
      throw new Error(`Review not found: ${id}`);
    }

    const timestamp = new Date().toISOString();

    let sql = `UPDATE reviews SET status = ?`;
    const params: Array<string | number | null> = [status];

    if (status === ReviewStatus.APPROVED) {
      sql = `UPDATE reviews SET status = ?, approved_at = ?, approved_by = ? WHERE id = ?`;
      params.push(timestamp, user || null, id);

      // Log approval
      await this.logger.info("review.approved", review.branch, {
        review_id: id,
        trace_id: review.trace_id,
        portal: review.portal ?? null,
        branch: review.branch,
        approved_by: user ?? null,
        approved_at: timestamp,
      }, review.trace_id);
    } else if (status === ReviewStatus.REJECTED) {
      sql = `UPDATE reviews SET status = ?, rejected_at = ?, rejected_by = ?, rejection_reason = ? WHERE id = ?`;
      params.push(timestamp, user || null, reason || null, id);

      // Log rejection
      await this.logger.info("review.rejected", review.branch, {
        review_id: id,
        trace_id: review.trace_id,
        portal: review.portal ?? null,
        branch: review.branch,
        rejected_by: user ?? null,
        rejected_at: timestamp,
        rejection_reason: reason ?? null,
      }, review.trace_id);
    } else {
      params.push(id);
    }

    await this.db.preparedRun(sql, params as SqliteParam[]);
  }

  /**
   * Get all reviews for a specific trace
   */
  async getByTrace(trace_id: string): Promise<IReview[]> {
    return await this.list({ trace_id });
  }

  /**
   * Get pending reviews for a portal
   */
  async getPendingForPortal(portal: string): Promise<IReview[]> {
    return await this.list({ portal, status: ReviewStatus.PENDING });
  }

  /**
   * Count reviews by status
   */
  async countByStatus(status: IReviewStatus): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM reviews WHERE status = ?`;
    const row = await this.db.preparedGet<{ count: number }>(sql, [status]);
    return row?.count || 0;
  }

  /**
   * Delete a review (for testing/cleanup only)
   */
  async delete(id: string): Promise<void> {
    const sql = `DELETE FROM reviews WHERE id = ?`;
    await this.db.preparedRun(sql, [id]);
  }
}
