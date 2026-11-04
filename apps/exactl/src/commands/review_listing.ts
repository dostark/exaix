/**
 * @module ReviewListing
 * @path apps/exactl/src/commands/review_listing.ts
 * @description Builds the review list of the exactl review command: artifact reviews, database code reviews and branch scans of the portal repositories.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/review_commands.ts]
 */

import { dirname, isAbsolute, join, resolve } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { RequestCommands } from "./request_commands.ts";
import { PlanCommands } from "./plan_commands.ts";
import { enrichWithRequest } from "../helpers/request_enricher.ts";
import { isReviewStatus, ReviewStatus } from "@exaix/core/status";
import type { IReviewStatus } from "@exaix/core/status";
import type { IArtifact, IArtifactFilters } from "@exaix/schemas/artifact.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { type ArtifactSubtype, ReviewType, ReviewTypeFilter as ReviewFilterEnum } from "@exaix/core";
import { classifyTraceAnomalies, summarizeAnomalies } from "@exaix/core/events";
import { GIT_CMD_BRANCH } from "@exaix/git/constants.ts";
import type { IReviewMetadata, ReviewTypeFilter } from "./review_commands.ts";

/** Collects the artifact reviews and the code reviews of the database and the portal repositories into one list. */
export class ReviewListing extends BaseCommand {
  private requestCommands: RequestCommands;
  private planCommands: PlanCommands;
  private readonly getDefaultBranch: (repoPath: string) => Promise<string>;
  private readonly getStoredReviewTraceId: (branch: string) => Promise<string | null>;
  private readonly getStoredReviewWorktreePath: (branch: string) => Promise<string | null>;
  private readonly resolveBaseBranchForBranch: (
    branch: string,
    repoPath: string,
    fallbackDefaultBranch: string,
  ) => Promise<string>;

  constructor(
    context: ICommandContext,
    getDefaultBranch: (repoPath: string) => Promise<string>,
    getStoredReviewTraceId: (branch: string) => Promise<string | null>,
    getStoredReviewWorktreePath: (branch: string) => Promise<string | null>,
    resolveBaseBranchForBranch: (branch: string, repoPath: string, fallbackDefaultBranch: string) => Promise<string>,
  ) {
    super(context);
    this.requestCommands = new RequestCommands(context);
    this.planCommands = new PlanCommands(context);
    this.getDefaultBranch = getDefaultBranch;
    this.getStoredReviewTraceId = getStoredReviewTraceId;
    this.getStoredReviewWorktreePath = getStoredReviewWorktreePath;
    this.resolveBaseBranchForBranch = resolveBaseBranchForBranch;
  }

  async listArtifacts(filters?: Opt<IArtifactFilters, Reason.QueryFilter>): Promise<IArtifact[]> {
    let query =
      `SELECT id, status, type, agent_role, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE 1=1`;
    const params: (string | null)[] = [];

    if (filters?.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters?.agent_role) {
      query += ` AND agent_role = ?`;
      params.push(filters.agent_role);
    }

    if (filters?.portal !== undefined) {
      query += ` AND portal = ?`;
      params.push(filters.portal);
    }

    if (filters?.type) {
      query += ` AND type = ?`;
      params.push(filters.type);
    }

    query += ` ORDER BY created DESC`;

    const rows = await this.db.preparedAll<{
      id: string;
      status: string;
      type: string;
      agent_role: string;
      portal: string | null;
      target_branch: string | null;
      created: string;
      updated: string | null;
      request_id: string;
      file_path: string;
      rejection_reason: string | null;
    }>(query, params);

    return rows.map((row) => ({
      id: row.id,
      status: isReviewStatus(row.status) ? row.status : ReviewStatus.PENDING,
      type: row.type as ArtifactSubtype,
      agent_role: row.agent_role,
      portal: row.portal,
      target_branch: row.target_branch,
      created: row.created,
      updated: row.updated,
      request_id: row.request_id,
      file_path: row.file_path,
      rejection_reason: row.rejection_reason,
    }));
  }

  async appendArtifactReviews(
    reviews: IReviewMetadata[],
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
  ): Promise<void> {
    const artifacts = await this.listArtifacts({
      status: normalizedStatus,
    });

    for (const artifact of artifacts) {
      reviews.push({
        type: ReviewType.ARTIFACT,
        branch: artifact.id,
        trace_id: artifact.id,
        request_id: artifact.request_id,
        files_changed: 0,
        created_at: artifact.created,
        agent_role: artifact.agent_role,
        file_path: artifact.file_path,
        portal: artifact.portal ?? undefined,
        status: artifact.status,
        rejected_at: artifact.status === ReviewStatus.REJECTED ? artifact.updated ?? undefined : undefined,
        rejection_reason: artifact.rejection_reason ?? undefined,
        approved_at: artifact.status === ReviewStatus.APPROVED ? artifact.updated ?? undefined : undefined,
      });
    }
  }

  private getDbReviewQuery(
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
  ): { sql: string; args: (string | number | boolean | null)[] } {
    const base =
      "SELECT trace_id, portal, branch, repository, base_branch, worktree_path, files_changed, created, created_by, status, approved_at, approved_by, rejected_at, rejected_by, rejection_reason FROM reviews";
    if (!normalizedStatus) return { sql: base, args: [] };
    return { sql: `${base} WHERE status = ?`, args: [normalizedStatus] };
  }

  async appendDbCodeReviews(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
  ): Promise<void> {
    try {
      const query = this.getDbReviewQuery(normalizedStatus);
      const rows = await this.db.preparedAll<{
        trace_id: string;
        portal: string | null;
        branch: string;
        repository: string;
        base_branch: string | null;
        worktree_path: string | null;
        files_changed: number | null;
        created: string;
        created_by: string;
        status: string;
        approved_at: string | null;
        approved_by: string | null;
        rejected_at: string | null;
        rejected_by: string | null;
        rejection_reason: string | null;
      }>(query.sql, query.args);

      for (const row of rows) {
        const basic = this.rowToBasicCodeReview(row);
        if (!basic) continue;
        dbBranches.add(basic.branch);
        await this.pushEnrichedOrBasic(reviews, basic);
      }
    } catch {
      // Older DB schema or missing table; ignore and fall back to git scanning.
    }
  }

  private rowToBasicCodeReview(row: {
    trace_id: string;
    portal: string | null;
    branch: string;
    base_branch: string | null;
    worktree_path: string | null;
    files_changed: number | null;
    created: string;
    created_by: string;
    status: string;
    approved_at: string | null;
    approved_by: string | null;
    rejected_at: string | null;
    rejected_by: string | null;
    rejection_reason: string | null;
  }): IReviewMetadata | null {
    const branch = row.branch?.trim();
    if (!branch) return null;

    const requestMatch = branch.match(/^feat\/(request-[\w]+)-/);
    const request_id = requestMatch?.[1] ?? `request-${row.trace_id?.substring(0, 8)}`;

    const normalizedStatus = typeof row.status === "string" ? row.status.toLowerCase().trim() : undefined;
    const status = isReviewStatus(normalizedStatus) ? normalizedStatus : undefined;

    return {
      type: ReviewType.CODE,
      branch,
      trace_id: row.trace_id,
      request_id,
      base_branch: row.base_branch ?? undefined,
      worktree_path: row.worktree_path ?? undefined,
      files_changed: row.files_changed ?? 0,
      created_at: row.created,
      agent_role: row.created_by,
      portal: row.portal ?? undefined,
      status,
      approved_at: row.approved_at ?? undefined,
      approved_by: row.approved_by ?? undefined,
      rejected_at: row.rejected_at ?? undefined,
      rejected_by: row.rejected_by ?? undefined,
      rejection_reason: row.rejection_reason ?? undefined,
    };
  }

  private async pushEnrichedOrBasic(reviews: IReviewMetadata[], basic: IReviewMetadata): Promise<void> {
    try {
      const enrichedMetadata = await this.extractReviewMetadataWithContext(basic);
      try {
        const activities = await this.db.getActivitiesByTraceSafe(basic.trace_id);
        const anomalySummary = summarizeAnomalies(classifyTraceAnomalies(activities));
        if (
          anomalySummary.high > 0 || anomalySummary.medium > 0 || anomalySummary.low > 0 || anomalySummary.recovered > 0
        ) {
          enrichedMetadata.anomalySummary = anomalySummary;
        }
      } catch {
        // silently skip anomalies on failure
      }
      reviews.push(enrichedMetadata);
    } catch {
      reviews.push(basic);
    }
  }

  async appendGitScannedCodeReviews(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
  ): Promise<void> {
    const portalPaths = await this.getPortalRepoPaths();

    for (const repoPath of portalPaths) {
      await this.appendGitScannedCodeReviewsFromRepo(reviews, dbBranches, normalizedStatus, repoPath);
    }
  }

  private async appendGitScannedCodeReviewsFromRepo(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
    repoPath: string,
  ): Promise<void> {
    const defaultBranch = await this.getDefaultBranch(repoPath);
    const branches = await this.listFeatBranches(repoPath);

    for (const branch of branches) {
      if (dbBranches.has(branch)) continue;
      const maybeReview = await this.buildCodeReviewFromGitBranch(repoPath, defaultBranch, branch, normalizedStatus);
      if (maybeReview) reviews.push(maybeReview);
    }
  }

  private async listFeatBranches(repoPath: string): Promise<string[]> {
    const branchesCmd = new Deno.Command("git", {
      args: [GIT_CMD_BRANCH, "--list", "feat/*"],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await branchesCmd.output();
    if (!success) return [];

    return new TextDecoder().decode(stdout)
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // '*' => current branch, '+' => checked out in another worktree
      .map((line) => line.replace(/^[*+]\s+/, ""));
  }

  private parseRequestAndTraceFromBranch(branch: string): { request_id: string; trace_id: string } | null {
    const match = branch.match(/^feat\/(request-[\w]+)-(.+)$/);
    if (!match) return null;
    return { request_id: match[1], trace_id: match[2] };
  }

  private async getBranchTimestampAndAgent(
    repoPath: string,
    branch: string,
  ): Promise<{ timestamp: string; agent_role: string } | null> {
    const logCmd = new Deno.Command("git", {
      args: ["log", branch, "--format=%H %aI %ae", "-1"],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const logResult = await logCmd.output();
    if (!logResult.success) return null;

    const logLine = new TextDecoder().decode(logResult.stdout).trim();
    const parts = logLine.split(" ");
    if (parts.length < 3) return null;
    return { timestamp: parts[1], agent_role: parts[2] };
  }

  private async getFilesChangedCount(repoPath: string, baseBranch: string, branch: string): Promise<number> {
    const diffCmd = new Deno.Command("git", {
      args: ["diff", "--name-only", `${baseBranch}...${branch}`],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const diffResult = await diffCmd.output();
    const files = new TextDecoder().decode(diffResult.stdout).trim().split("\n").filter((f) => f);
    return files.length;
  }

  private getStatusFromActivities(activities: Array<{ action_type: string }>): IReviewStatus {
    let hasRejected = false;
    for (const a of activities) {
      if (a.action_type === "review.approved") return ReviewStatus.APPROVED;
      if (a.action_type === "review.rejected") hasRejected = true;
    }
    return hasRejected ? ReviewStatus.REJECTED : ReviewStatus.PENDING;
  }

  private async buildCodeReviewFromGitBranch(
    repoPath: string,
    defaultBranch: string,
    branch: string,
    normalizedStatus: Opt<IReviewStatus, Reason.QueryFilter>,
  ): Promise<IReviewMetadata | null> {
    const parsed = this.parseRequestAndTraceFromBranch(branch);
    if (!parsed) return null;

    const logInfo = await this.getBranchTimestampAndAgent(repoPath, branch);
    if (!logInfo) return null;

    const baseBranch = await this.resolveBaseBranchForBranch(branch, repoPath, defaultBranch);
    const storedWorktreePath = await this.getStoredReviewWorktreePath(branch);
    const storedTraceId = await this.getStoredReviewTraceId(branch);
    const effectiveTraceId = storedTraceId ?? parsed.trace_id;
    const activities = await this.db.getActivitiesByTraceSafe(effectiveTraceId);
    const status = this.getStatusFromActivities(activities);
    if (normalizedStatus && status !== normalizedStatus) return null;

    const anomalySummary = summarizeAnomalies(classifyTraceAnomalies(activities));

    const filesChanged = await this.getFilesChangedCount(repoPath, baseBranch, branch);

    const basicMetadata: IReviewMetadata = {
      type: ReviewType.CODE,
      branch,
      trace_id: effectiveTraceId,
      request_id: parsed.request_id,
      base_branch: baseBranch,
      worktree_path: storedWorktreePath ?? undefined,
      files_changed: filesChanged,
      created_at: logInfo.timestamp,
      agent_role: logInfo.agent_role,
      status,
      anomalySummary:
        anomalySummary.high > 0 || anomalySummary.medium > 0 || anomalySummary.low > 0 || anomalySummary.recovered > 0
          ? anomalySummary
          : undefined,
    };

    return await this.extractReviewMetadataWithContext(basicMetadata);
  }

  private async getPortalRepoPaths(): Promise<string[]> {
    const portalPaths = await this.scanPortalDirectory();

    // Also scan configured portals (fallback for missing/broken symlinks)
    for (const portal of this.config.portals || []) {
      try {
        await Deno.stat(join(portal.target_path, ".git"));
        if (!portalPaths.includes(portal.target_path)) {
          portalPaths.push(portal.target_path);
        }
      } catch {
        continue;
      }
    }

    // Also scan the repositories that the reviews table records.
    try {
      const rows = await this.db.preparedAll<{ repository: string }>(
        "SELECT DISTINCT repository FROM reviews WHERE repository IS NOT NULL AND repository != ''",
      );

      for (const row of rows) {
        const repoPath = row.repository?.trim();
        if (!repoPath) continue;
        if (portalPaths.includes(repoPath)) continue;

        try {
          await Deno.stat(join(repoPath, ".git"));
          portalPaths.push(repoPath);
        } catch {
          // Skip non-existent or non-git repos.
          continue;
        }
      }
    } catch {
      // Older DB schema or missing table; ignore.
    }

    // Also check workspace root for reviews (legacy/fallback)
    portalPaths.push(this.config.system.root);

    return portalPaths;
  }

  /** Lists the git repositories that the Portals directory links to. A missing directory gives an empty list. */
  async scanPortalDirectory(): Promise<string[]> {
    const portalsDir = join(this.config.system.root, this.config.paths.portals);
    const portalPaths: string[] = [];
    try {
      for await (const entry of Deno.readDir(portalsDir)) {
        const portalEntryPath = join(portalsDir, entry.name);
        try {
          // Prefer resolving symlink targets if possible, but also allow direct directories.
          const resolvedPath = await Deno.readLink(portalEntryPath)
            .then((linkTarget) => this.resolvePortalEntryTarget(portalEntryPath, linkTarget))
            .catch(() => portalEntryPath);
          // Skip broken portals and non-git repos.
          await Deno.stat(join(resolvedPath, ".git"));
          portalPaths.push(resolvedPath);
        } catch {
          continue;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    return portalPaths;
  }

  private resolvePortalEntryTarget(portalEntryPath: string, linkTarget: string): string {
    if (isAbsolute(linkTarget)) return linkTarget;
    return resolve(dirname(portalEntryPath), linkTarget);
  }

  shouldIncludeArtifacts(type: ReviewTypeFilter): boolean {
    return type === ReviewFilterEnum.ALL || type === ReviewFilterEnum.ARTIFACT;
  }

  shouldIncludeCode(type: ReviewTypeFilter): boolean {
    return type === ReviewFilterEnum.ALL || type === ReviewFilterEnum.CODE;
  }

  sortReviewsNewestFirst(reviews: IReviewMetadata[]): IReviewMetadata[] {
    return reviews.sort((a, b) => {
      const ta = Number(new Date(a.created_at));
      const tb = Number(new Date(b.created_at));
      return (tb || 0) - (ta || 0);
    });
  }

  async extractReviewMetadataWithContext(
    basicMetadata: IReviewMetadata,
  ): Promise<IReviewMetadata> {
    const metadata = await enrichWithRequest(
      this.requestCommands,
      basicMetadata,
      `review ${basicMetadata.request_id}`,
    );

    // Try to find associated plan using trace_id
    if (metadata.trace_id) {
      try {
        const plans = await this.planCommands.list();
        const associatedPlan = plans.find((plan) => plan.trace_id === metadata.trace_id);

        if (associatedPlan) {
          metadata.plan_id = associatedPlan.id;
          metadata.plan_status = associatedPlan.status;
          // Propagate subject from plan if not already set (e.g. from request)
          if (!metadata.subject && associatedPlan.subject) {
            metadata.subject = associatedPlan.subject;
          }
        }
      } catch (error) {
        // If plan can't be loaded, continue without plan info
        console.warn(`Warning: Could not load plan info for review ${metadata.request_id}:`, error);
      }
    }

    return metadata;
  }
}
