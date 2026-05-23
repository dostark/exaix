/**
 * @module ReviewCommands
 * @path apps/exactl/src/commands/review_commands.ts
 * @description Provides CLI commands for reviewing agent-generated changes, including approval/rejection of code branches and artifacts.
 * @architectural-layer CLI
 * @related-files ["packages/core/src/status/review_status.ts", "apps/daemon/main.ts"]
 */

import { dirname, isAbsolute, join, resolve } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { RequestCommands } from "./request_commands.ts";
import { PlanCommands } from "./plan_commands.ts";
import { ValidationChain } from "@exaix/cli/validation/validation_chain.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";
import { enrichWithRequest } from "../helpers/request_enricher.ts";
import { isReviewStatus, ReviewStatus } from "@exaix/core/status";
import type { IReviewStatus } from "@exaix/core/status";
import type { IArtifact, IArtifactFilters, IArtifactWithContent } from "@exaix/schemas/artifact.ts";
import type { IGitService } from "@exaix/core/types";
import { type ArtifactSubtype, ReviewType, ReviewTypeFilter as ReviewFilterEnum } from "@exaix/core";
import { GitBranchName } from "@exaix/git";
import { createGitService } from "../../../../src/services/adapters/git_adapter.ts";
import { GIT_CMD_BRANCH, GIT_CMD_LIST, GIT_CMD_REV_PARSE, GIT_CMD_WORKTREE } from "@exaix/git";

export interface IReviewMetadata {
  type?: ReviewType;
  file_path?: string;
  branch: string;
  trace_id: string;
  request_id: string;
  base_branch?: string;
  worktree_path?: string;
  files_changed: number;
  created_at: string;
  identity_id: string;
  // Request context
  request_subject?: string;
  request_identity?: string;
  request_portal?: string;
  request_priority?: string;
  request_created_by?: string;
  request_flow?: string;
  request_rejected_path?: string;
  // Plan context
  plan_id?: string;
  plan_status?: string;
  // Portal context
  portal?: string;
  // Status context
  status?: IReviewStatus;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  subject?: string;
}

export interface ReviewDetails extends IReviewMetadata {
  diff: string;
  commits: Array<{
    sha: string;
    message: string;
    timestamp: string;
  }>;
}

export type ReviewTypeFilter = ReviewFilterEnum;

type ArtifactFrontmatterData = {
  status?: IReviewStatus;
  type?: ArtifactSubtype;
  agent?: string;
  portal?: string | null;
  target_branch?: string | null;
  created?: string;
  request_id?: string;
};

/**
 * Commands for reviewing and managing agent-generated code reviews
 */
export class ReviewCommands extends BaseCommand {
  private requestCommands: RequestCommands;
  private planCommands: PlanCommands;

  constructor(context: ICommandContext) {
    super(context);
    this.requestCommands = new RequestCommands(context);
    this.planCommands = new PlanCommands(context);
  }

  private isArtifactId(id: string): boolean {
    return id.startsWith("artifact-");
  }

  private normalizeTypeFilter(typeFilter?: string): ReviewTypeFilter {
    if (!typeFilter) return ReviewFilterEnum.ALL;
    const normalized = typeFilter.toLowerCase();

    if (normalized === "code") return ReviewFilterEnum.CODE;
    if (normalized === "artifact") return ReviewFilterEnum.ARTIFACT;
    if (normalized === "all") return ReviewFilterEnum.ALL;

    return ReviewFilterEnum.ALL;
  }

  private normalizeStatusFilter(
    statusFilter?: string,
  ): IReviewStatus | undefined {
    if (!statusFilter) return undefined;
    const normalized = statusFilter.toLowerCase();
    return isReviewStatus(normalized) ? normalized : undefined;
  }

  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      // Try to get the default branch from symbolic-ref
      const checkCmd = new Deno.Command("git", {
        args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
        cwd: repoPath,
        stdout: "piped",
        stderr: "piped",
      });
      const result = await checkCmd.output();
      if (result.success) {
        const ref = new TextDecoder().decode(result.stdout).trim();
        // Result will be like "refs/remotes/origin/main" or "refs/remotes/origin/master"
        const branchName = ref.split("/").pop();
        if (branchName) {
          return branchName;
        }
      }
    } catch {
      // If that fails (no remote), continue to fallback
    }

    // Fallback: try common default branch names
    const commonDefaults = [
      GitBranchName.MAIN,
      GitBranchName.MASTER,
      GitBranchName.DEVELOP,
      GitBranchName.DEVELOPMENT,
    ];
    for (const branch of commonDefaults) {
      try {
        const checkCmd = new Deno.Command("git", {
          args: [GIT_CMD_REV_PARSE, "--verify", branch],
          cwd: repoPath,
          stdout: "piped",
          stderr: "piped",
        });
        const result = await checkCmd.output();
        if (result.success) {
          return branch;
        }
      } catch {
        continue;
      }
    }

    // Ultimate fallback
    return GitBranchName.MAIN;
  }

  private async getStoredReviewBaseBranch(branch: string): Promise<string | null> {
    try {
      const row = await this.db.preparedGet<{ base_branch: string | null }>(
        "SELECT base_branch FROM reviews WHERE branch = ?",
        [branch],
      );
      const base = row?.base_branch?.trim();
      return base ? base : null;
    } catch {
      // Older DB schema or missing table/column; fall back to heuristics.
      return null;
    }
  }

  private async bestEffortLinkRequestRejection(
    requestId: string | undefined,
    rejectedRelative: string,
  ): Promise<void> {
    if (!requestId) return;

    try {
      const config = this.config;
      const requestPath = join(
        config.system.root,
        config.paths.workspace,
        config.paths.requests,
        `${requestId}.md`,
      );
      if (!await exists(requestPath)) return;

      const content = await Deno.readTextFile(requestPath);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fmMatch) return;
      let fm = fmMatch[1];

      if (/^rejected_path:/m.test(fm)) {
        fm = fm.replace(/^rejected_path:.*$/m, `rejected_path: ${rejectedRelative}`);
      } else {
        fm = fm.trimEnd() + `\nrejected_path: ${rejectedRelative}`;
      }

      const updated = `---\n${fm}\n---\n` + content.slice(fmMatch[0].length);
      await Deno.writeTextFile(requestPath, updated);
      await this.display.info("request.rejected_linked", requestPath, {
        request_id: requestId,
        rejected_path: rejectedRelative,
        via: "cli",
      });
    } catch (err) {
      await this.display.warn("request.rejection_update_failed", requestId, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async getStoredReviewWorktreePath(branch: string): Promise<string | null> {
    try {
      const row = await this.db.preparedGet<{ worktree_path: string | null }>(
        "SELECT worktree_path FROM reviews WHERE branch = ?",
        [branch],
      );
      const worktreePath = row?.worktree_path?.trim();
      return worktreePath ? worktreePath : null;
    } catch {
      // Older DB schema or missing table/column.
      return null;
    }
  }

  private async getStoredReviewTraceId(branch: string): Promise<string | null> {
    try {
      const row = await this.db.preparedGet<{ trace_id: string | null }>(
        "SELECT trace_id FROM reviews WHERE branch = ?",
        [branch],
      );
      const traceId = row?.trace_id?.trim();
      return traceId ? traceId : null;
    } catch {
      // Older DB schema or missing table/column.
      return null;
    }
  }

  private async resolveBaseBranchForBranch(
    branch: string,
    repoPath: string,
    fallbackDefaultBranch: string,
  ): Promise<string> {
    const stored = await this.getStoredReviewBaseBranch(branch);
    if (stored) return stored;
    // Fallback: existing heuristic default branch logic
    return fallbackDefaultBranch || await this.getDefaultBranch(repoPath);
  }

  private getExecutionWorktreePointerPath(traceId: string): string {
    return join(
      this.config.system.root,
      this.config.paths.memory,
      this.config.paths.memoryExecution,
      traceId,
      GIT_CMD_WORKTREE,
    );
  }

  private async removeExecutionWorktreePointer(traceId: string): Promise<void> {
    const pointerPath = this.getExecutionWorktreePointerPath(traceId);

    try {
      const info = await Deno.lstat(pointerPath);
      if (info.isSymlink) {
        await Deno.remove(pointerPath);
      } else {
        await Deno.remove(pointerPath, { recursive: true });
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
  }

  private async cleanupWorktreeReview(
    portalGitService: Pick<IGitService, "runGitCommand">,
    review: ReviewDetails,
  ): Promise<void> {
    const worktreePath = review.worktree_path?.trim();
    if (!worktreePath) return;

    // 1) Remove worktree checkout to release the branch.
    await portalGitService.runGitCommand([GIT_CMD_WORKTREE, "remove", "--force", worktreePath]);

    // 2) Delete feature branch.
    await portalGitService.runGitCommand([GIT_CMD_BRANCH, "-D", review.branch]);

    // 3) Remove discoverability pointer (avoid dangling symlink/PATH.txt).
    await this.removeExecutionWorktreePointer(review.trace_id);
  }

  private async bestEffortAbortMerge(portalGitService: Pick<IGitService, "runGitCommand">): Promise<void> {
    try {
      await portalGitService.runGitCommand(["merge", "--abort"], { throwOnError: false });
    } catch {
      // Best-effort only
    }
  }

  private async bestEffortCleanupWorktreeCheckout(
    portalGitService: Pick<IGitService, "runGitCommand">,
    review: ReviewDetails,
  ): Promise<void> {
    const worktreePath = review.worktree_path?.trim();
    if (!worktreePath) return;

    try {
      await portalGitService.runGitCommand([GIT_CMD_WORKTREE, "remove", "--force", worktreePath], {
        throwOnError: false,
      });
    } catch {
      // Best-effort only
    }

    try {
      await this.removeExecutionWorktreePointer(review.trace_id);
    } catch {
      // Best-effort only
    }
  }

  private resolvePortalEntryTarget(portalEntryPath: string, linkTarget: string): string {
    if (isAbsolute(linkTarget)) return linkTarget;
    return resolve(dirname(portalEntryPath), linkTarget);
  }

  private async findRepoForBranch(branchName: string): Promise<string> {
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

    portalPaths.push(this.config.system.root);

    for (const repoPath of portalPaths) {
      const checkCmd = new Deno.Command("git", {
        args: [GIT_CMD_REV_PARSE, "--verify", branchName],
        cwd: repoPath,
        stdout: "piped",
        stderr: "piped",
      });
      const result = await checkCmd.output();
      if (result.success) {
        return repoPath;
      }
    }

    throw new Error(`Branch not found in any repository: ${branchName}`);
  }

  private async createPortalGitService(
    repoPath: string,
    traceId: string,
  ): Promise<Pick<IGitService, "runGitCommand">> {
    const portalGitService = createGitService({
      config: this.config,
      db: this.db,
      repoPath,
      traceId,
      identityId: await this.getUserIdentity(),
    });

    return {
      runGitCommand: (args, options) => portalGitService.runGitCommand(args, options),
    };
  }

  private async getArtifactRecord(artifactId: string): Promise<IArtifact> {
    const rows = await this.db.preparedAll<{
      id: string;
      status: string;
      type: string;
      identity: string;
      portal: string | null;
      target_branch: string | null;
      created: string;
      updated: string | null;
      request_id: string;
      file_path: string;
      rejection_reason: string | null;
    }>(
      `SELECT id, status, type, identity, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE id = ?`,
      [artifactId],
    );

    if (rows.length === 0) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const row = rows[0];
    const status = isReviewStatus(row.status) ? row.status : ReviewStatus.PENDING;

    return {
      id: row.id,
      status,
      type: row.type as ArtifactSubtype,
      identity: row.identity,
      portal: row.portal,
      target_branch: row.target_branch,
      created: row.created,
      updated: row.updated,
      request_id: row.request_id,
      file_path: row.file_path,
      rejection_reason: row.rejection_reason,
    };
  }

  private async listArtifacts(filters?: IArtifactFilters): Promise<IArtifact[]> {
    let query =
      `SELECT id, status, type, identity, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE 1=1`;
    const params: (string | null)[] = [];

    if (filters?.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters?.identity) {
      query += ` AND identity = ?`;
      params.push(filters.identity);
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
      identity: string;
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
      identity: row.identity,
      portal: row.portal,
      target_branch: row.target_branch,
      created: row.created,
      updated: row.updated,
      request_id: row.request_id,
      file_path: row.file_path,
      rejection_reason: row.rejection_reason,
    }));
  }

  private async getArtifact(artifactId: string): Promise<IArtifactWithContent> {
    const artifact = await this.getArtifactRecord(artifactId);
    const content = await Deno.readTextFile(join(this.config.system.root, artifact.file_path));
    const match = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);

    return {
      ...artifact,
      content,
      body: match ? match[1] : "",
    };
  }

  private async updateArtifactStatus(
    artifactId: string,
    status: Exclude<IReviewStatus, typeof ReviewStatus.PENDING>,
    reason?: string,
  ): Promise<void> {
    const artifact = await this.getArtifactRecord(artifactId);
    const fullPath = join(this.config.system.root, artifact.file_path);
    const content = await Deno.readTextFile(fullPath);
    const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);

    if (!match) {
      throw new Error(`Invalid artifact format: ${artifactId}`);
    }

    const frontmatter = parseYaml(match[1]) as ArtifactFrontmatterData;
    frontmatter.status = status;

    const updatedContent = `---\n${stringifyYaml(frontmatter)}---\n\n${match[2]}`;
    await Deno.writeTextFile(fullPath, updatedContent);

    await this.db.preparedRun(
      `UPDATE artifacts SET status = ?, updated = ?, rejection_reason = ? WHERE id = ?`,
      [status, new Date().toISOString(), reason || null, artifactId],
    );
  }

  private async extractReviewMetadataWithContext(
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

  private async getPortalRepoPaths(): Promise<string[]> {
    const portalPaths: string[] = [];
    const portalsDir = join(this.config.system.root, this.config.paths.portals);

    // Get all portal directories
    try {
      for await (const entry of Deno.readDir(portalsDir)) {
        const portalEntryPath = join(portalsDir, entry.name);
        try {
          // Prefer resolving symlink targets if possible, but also allow direct directories.
          const resolvedPath = await Deno.readLink(portalEntryPath)
            .then((linkTarget) => this.resolvePortalEntryTarget(portalEntryPath, linkTarget))
            .catch(() => portalEntryPath);
          // Check if target still exists and is a git repo
          await Deno.stat(join(resolvedPath, ".git"));
          portalPaths.push(resolvedPath);
        } catch {
          // Skip broken portals or non-git repos
          continue;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // Portals directory doesn't exist yet - continue with empty list
    }

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

    // Also scan repositories recorded in the reviews table.
    // This makes `review list` resilient even if `Portals/<alias>` symlinks are missing
    // or the CLI config does not include the portal entry.
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

  /**
   * List all pending reviews (agent-created branches)
   * @param statusFilter Optional filter: 'pending', 'approved', 'rejected'
   * @returns List of review metadata
   */
  async list(statusFilter?: string, typeFilter?: string): Promise<IReviewMetadata[]> {
    const requestedType = this.normalizeTypeFilter(typeFilter);
    const normalizedStatus = this.normalizeStatusFilter(statusFilter);
    const reviews: IReviewMetadata[] = [];

    if (this.shouldIncludeArtifacts(requestedType)) {
      await this.appendArtifactReviews(reviews, normalizedStatus);
    }

    if (!this.shouldIncludeCode(requestedType)) {
      return this.sortReviewsNewestFirst(reviews);
    }

    const dbBranches = new Set<string>();
    await this.appendDbCodeReviews(reviews, dbBranches, normalizedStatus);
    await this.appendGitScannedCodeReviews(reviews, dbBranches, normalizedStatus);

    return this.sortReviewsNewestFirst(reviews);
  }

  private shouldIncludeArtifacts(type: ReviewTypeFilter): boolean {
    return type === ReviewFilterEnum.ALL || type === ReviewFilterEnum.ARTIFACT;
  }

  private shouldIncludeCode(type: ReviewTypeFilter): boolean {
    return type === ReviewFilterEnum.ALL || type === ReviewFilterEnum.CODE;
  }

  private sortReviewsNewestFirst(reviews: IReviewMetadata[]): IReviewMetadata[] {
    return reviews.sort((a, b) => {
      const ta = Number(new Date(a.created_at));
      const tb = Number(new Date(b.created_at));
      return (tb || 0) - (ta || 0);
    });
  }

  private async appendArtifactReviews(
    reviews: IReviewMetadata[],
    normalizedStatus: IReviewStatus | undefined,
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
        identity_id: artifact.identity,
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
    normalizedStatus: IReviewStatus | undefined,
  ): { sql: string; args: (string | number | boolean | null)[] } {
    const base =
      "SELECT trace_id, portal, branch, repository, base_branch, worktree_path, files_changed, created, created_by, status, approved_at, approved_by, rejected_at, rejected_by, rejection_reason FROM reviews";
    if (!normalizedStatus) return { sql: base, args: [] };
    return { sql: `${base} WHERE status = ?`, args: [normalizedStatus] };
  }

  private async appendDbCodeReviews(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: IReviewStatus | undefined,
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
      identity_id: row.created_by,
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
      reviews.push(enrichedMetadata);
    } catch {
      reviews.push(basic);
    }
  }

  private async appendGitScannedCodeReviews(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: IReviewStatus | undefined,
  ): Promise<void> {
    const portalPaths = await this.getPortalRepoPaths();

    for (const repoPath of portalPaths) {
      await this.appendGitScannedCodeReviewsFromRepo(reviews, dbBranches, normalizedStatus, repoPath);
    }
  }

  private async appendGitScannedCodeReviewsFromRepo(
    reviews: IReviewMetadata[],
    dbBranches: Set<string>,
    normalizedStatus: IReviewStatus | undefined,
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
  ): Promise<{ timestamp: string; identity_id: string } | null> {
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
    return { timestamp: parts[1], identity_id: parts[2] };
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
    normalizedStatus: IReviewStatus | undefined,
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
      identity_id: logInfo.identity_id,
      status,
    };

    return await this.extractReviewMetadataWithContext(basicMetadata);
  }

  /**
   * Show detailed review information including diff
   * @param branchName Branch name or request_id
   * @returns Review details
   */
  async show(branchName: string): Promise<ReviewDetails> {
    // Artifact-backed review
    if (this.isArtifactId(branchName)) {
      const artifact = await this.getArtifact(branchName);
      return {
        type: ReviewType.ARTIFACT,
        branch: artifact.id,
        trace_id: artifact.id,
        request_id: artifact.request_id,
        files_changed: 0,
        created_at: artifact.created,
        identity_id: artifact.identity,
        portal: artifact.portal ?? undefined,
        status: artifact.status,
        rejection_reason: artifact.rejection_reason ?? undefined,
        approved_at: artifact.status === ReviewStatus.APPROVED ? artifact.updated ?? undefined : undefined,
        rejected_at: artifact.status === ReviewStatus.REJECTED ? artifact.updated ?? undefined : undefined,
        diff: artifact.body,
        commits: [],
      };
    }

    // If not a full branch name, try to find matching branch
    let fullBranch = branchName;
    if (!branchName.startsWith("feat/")) {
      const branches = await this.list(undefined, ReviewFilterEnum.CODE);
      const match = branches.find((b) => b.request_id === branchName || b.branch === `feat/${branchName}`);
      if (match) {
        fullBranch = match.branch;
      } else {
        // Fallback: allow request_id shorthand for artifacts
        const artifacts = await this.listArtifacts();
        const byRequest = artifacts.find((a) => a.request_id === branchName);
        if (byRequest) {
          const artifact = await this.getArtifact(byRequest.id);
          return {
            type: ReviewType.ARTIFACT,
            branch: artifact.id,
            trace_id: artifact.id,
            request_id: artifact.request_id,
            files_changed: 0,
            created_at: artifact.created,
            identity_id: artifact.identity,
            file_path: artifact.file_path,
            portal: artifact.portal ?? undefined,
            status: artifact.status,
            rejection_reason: artifact.rejection_reason ?? undefined,
            approved_at: artifact.status === ReviewStatus.APPROVED ? artifact.updated ?? undefined : undefined,
            rejected_at: artifact.status === ReviewStatus.REJECTED ? artifact.updated ?? undefined : undefined,
            diff: artifact.body,
            commits: [],
          };
        }

        throw new Error(`Review not found: ${branchName}\nRun 'exactl review list' to see available reviews`);
      }
    }

    const repoPath = await this.findRepoForBranch(fullBranch);
    const defaultBranch = await this.getDefaultBranch(repoPath);
    const baseBranch = await this.resolveBaseBranchForBranch(fullBranch, repoPath, defaultBranch);
    const storedWorktreePath = await this.getStoredReviewWorktreePath(fullBranch);
    const storedTraceId = await this.getStoredReviewTraceId(fullBranch);

    // Verify branch exists
    const checkCmd = new Deno.Command("git", {
      args: [GIT_CMD_REV_PARSE, "--verify", fullBranch],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const checkResult = await checkCmd.output();
    if (!checkResult.success) {
      throw new Error(`Branch not found: ${fullBranch}`);
    }

    // Get commit history
    const logCmd = new Deno.Command("git", {
      args: [
        "log",
        fullBranch,
        "--not",
        baseBranch,
        "--format=%H|||%s|||%aI",
      ],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const logResult = await logCmd.output();
    const commits = new TextDecoder().decode(logResult.stdout)
      .trim()
      .split("\n")
      .filter((l) => l)
      .map((line) => {
        const [sha, message, timestamp] = line.split("|||");
        return { sha, message, timestamp };
      });

    // Get diff
    const diffCmd = new Deno.Command("git", {
      args: ["diff", `${baseBranch}...${fullBranch}`],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const diffResult = await diffCmd.output();
    const diff = new TextDecoder().decode(diffResult.stdout);

    // Get files changed count
    const filesCmd = new Deno.Command("git", {
      args: ["diff", "--name-only", `${baseBranch}...${fullBranch}`],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });

    const filesResult = await filesCmd.output();
    const files = new TextDecoder().decode(filesResult.stdout).trim().split("\n").filter((f) => f);

    // Extract metadata from branch name
    // request_id format: request-NNN, trace_id format: xxx-yyy-zzz
    const match = fullBranch.match(/^feat\/(request-[\w]+)-(.+)$/);
    const [, request_id, trace_id] = match || ["", fullBranch, "unknown"];

    const basicMetadata = {
      type: ReviewType.CODE,
      branch: fullBranch,
      trace_id: storedTraceId ?? trace_id,
      request_id,
      base_branch: baseBranch,
      worktree_path: storedWorktreePath ?? undefined,
      files_changed: files.length,
      created_at: commits[commits.length - 1]?.timestamp || new Date().toISOString(),
      identity_id: commits[0]?.sha.substring(0, 8) || "unknown",
    } as IReviewMetadata;

    // Enrich with request and plan context
    const enrichedMetadata = await this.extractReviewMetadataWithContext(basicMetadata);

    return {
      ...enrichedMetadata,
      diff,
      commits,
    };
  }

  /**
   * Approve review - merge branch to main
   * @param branchName Branch name or request_id
   */
  async approve(branchName: string): Promise<void> {
    try {
      // Validate input
      const validation = new ValidationChain()
        .addRule("branchName", ValidationChain.required())
        .addRule("branchName", ValidationChain.isString())
        .validate({ branchName });

      if (!validation.isValid) {
        throw new Error(CommandUtils.formatValidationErrors(validation));
      }

      // Artifact approval path
      if (this.isArtifactId(branchName)) {
        await this.updateArtifactStatus(branchName, ReviewStatus.APPROVED);
        await this.display.info(
          "review.approved",
          branchName,
          {
            artifact_id: branchName,
            approved_at: new Date().toISOString(),
            via: "cli",
            command: this.getCommandLineString(),
          },
          branchName,
        );
        return;
      }

      const review = await this.show(branchName);

      // If show() resolved to an artifact via request_id shorthand
      if (review.type === "artifact") {
        await this.updateArtifactStatus(review.branch, ReviewStatus.APPROVED);
        await this.display.info(
          "review.approved",
          review.request_id,
          {
            artifact_id: review.branch,
            approved_at: new Date().toISOString(),
            via: "cli",
            command: this.getCommandLineString(),
          },
          review.trace_id,
        );
        return;
      }
      const repoPath = await this.findRepoForBranch(review.branch);

      // Get the default branch for this repository
      const defaultBranch = await this.getDefaultBranch(repoPath);
      const baseBranch = await this.resolveBaseBranchForBranch(review.branch, repoPath, defaultBranch);

      // Verify we're on the default branch
      const currentBranchCmd = new Deno.Command("git", {
        args: [GIT_CMD_BRANCH, "--show-current"],
        cwd: repoPath,
        stdout: "piped",
        stderr: "piped",
      });

      const branchResult = await currentBranchCmd.output();
      const currentBranch = new TextDecoder().decode(branchResult.stdout).trim();

      if (currentBranch !== baseBranch) {
        throw new Error(
          `Must be on '${baseBranch}' branch to approve reviews (currently on '${currentBranch}')\nRun: git checkout ${baseBranch}`,
        );
      }

      const portalGitService = await this.createPortalGitService(repoPath, review.trace_id);

      // Merge branch
      try {
        await portalGitService.runGitCommand([
          "merge",
          "--no-ff",
          review.branch,
          "-m",
          `Merge ${review.request_id}: ${
            review.commits[0]?.message || "agent changes"
          }\n\nTrace-Id: ${review.trace_id}`,
        ]);
      } catch (mergeError) {
        // Phase 37.7 (negative path): if merge fails (e.g., conflict), avoid leaving the repo
        // in a conflicted state and ensure we don't orphan a worktree checkout.
        if (review.worktree_path) {
          await this.bestEffortAbortMerge(portalGitService);
          await this.bestEffortCleanupWorktreeCheckout(portalGitService, review);
        }
        throw mergeError;
      }

      // Get merge commit SHA
      const shaResult = await portalGitService.runGitCommand([GIT_CMD_REV_PARSE, "HEAD"]);
      const commitSha = shaResult.output.trim();

      // Log approval with user identity
      const _userIdentity = await this.getUserIdentity();
      await this.display.info("review.approved", review.request_id, {
        commit_sha: commitSha,
        branch: review.branch,
        files_changed: review.files_changed,
        approved_at: new Date().toISOString(),
        via: "cli",
        command: this.getCommandLineString(),
      }, review.trace_id);

      // Phase 37.7: worktree lifecycle cleanup (opt-in strategy leaves an extra checkout).
      // Keep branch-based reviews unchanged; only auto-clean worktree-based ones.
      if (review.worktree_path) {
        await this.cleanupWorktreeReview(portalGitService, review);
      }
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "ReviewCommands.approve",
        args: { branchName },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Reject review - delete branch without merging
   * @param branchName Branch name or request_id
   * @param reason Rejection reason
   */
  async reject(branchName: string, reason: string): Promise<void> {
    try {
      // Validate input
      const validation = new ValidationChain()
        .addRule("branchName", ValidationChain.required())
        .addRule("reason", (val) => (typeof val !== "string" || val.trim().length === 0) ? "is required" : null)
        .validate({ branchName, reason });

      if (!validation.isValid) {
        throw new Error(
          CommandUtils.formatValidationErrors(validation) +
            '\nUse: exactl review reject <id> --reason "your reason"',
        );
      }

      // Artifact rejection path
      if (this.isArtifactId(branchName)) {
        await this.updateArtifactStatus(branchName, ReviewStatus.REJECTED, reason);
        await this.display.info(
          "review.rejected",
          branchName,
          {
            artifact_id: branchName,
            rejection_reason: reason,
            rejected_at: new Date().toISOString(),
            via: "cli",
            command: this.getCommandLineString(),
          },
          branchName,
        );

        // Persist a rejected artifact copy for discoverability, then link to request (best-effort)
        try {
          const artifact = await this.getArtifact(branchName);
          const config = this.config;
          const rejectedDir = join(config.system.root, config.paths.workspace, config.paths.rejected);
          await ensureDir(rejectedDir);
          const target = join(rejectedDir, `${branchName}_rejected.md`);
          await Deno.writeTextFile(target, artifact.content);

          const rejectedRelative = join(
            config.paths.workspace,
            config.paths.rejected,
            `${branchName}_rejected.md`,
          );
          await this.bestEffortLinkRequestRejection(artifact.request_id, rejectedRelative);
        } catch (err) {
          await this.display.warn("review.rejected_artifact_persist_failed", branchName, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return;
      }

      const review = await this.show(branchName);

      // If show() resolved to an artifact via request_id shorthand
      if (review.type === "artifact") {
        await this.updateArtifactStatus(review.branch, ReviewStatus.REJECTED, reason);
        await this.display.info(
          "review.rejected",
          review.request_id,
          {
            artifact_id: review.branch,
            rejection_reason: reason,
            rejected_at: new Date().toISOString(),
            via: "cli",
            command: this.getCommandLineString(),
          },
          review.trace_id,
        );

        // Persist a rejected artifact copy for discoverability, then link to request (best-effort)
        try {
          const artifact = await this.getArtifact(review.branch);
          const config = this.config;
          const rejectedDir = join(config.system.root, config.paths.workspace, config.paths.rejected);
          await ensureDir(rejectedDir);
          const target = join(rejectedDir, `${review.branch}_rejected.md`);
          await Deno.writeTextFile(target, artifact.content);

          const rejectedRelative = join(
            config.paths.workspace,
            config.paths.rejected,
            `${review.branch}_rejected.md`,
          );
          await this.bestEffortLinkRequestRejection(artifact.request_id, rejectedRelative);
        } catch (err) {
          await this.display.warn("review.rejected_artifact_persist_failed", review.branch, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return;
      }
      const repoPath = await this.findRepoForBranch(review.branch);

      const portalGitService = await this.createPortalGitService(repoPath, review.trace_id);

      if (review.worktree_path) {
        await this.cleanupWorktreeReview(portalGitService, review);
      } else {
        await this.deleteBranchWithWorktreeHandling(portalGitService, review.branch, repoPath);
      }

      // Log rejection with user identity
      const _userIdentity = await this.getUserIdentity();
      await this.display.info("review.rejected", review.request_id, {
        branch: review.branch,
        rejection_reason: reason,
        files_changed: review.files_changed,
        rejected_at: new Date().toISOString(),
        via: "cli",
        command: this.getCommandLineString(),
      }, review.trace_id);
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "ReviewCommands.reject",
        args: { branchName, reason },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  private async deleteBranchWithWorktreeHandling(
    portalGitService: Pick<IGitService, "runGitCommand">,
    branch: string,
    repoPath: string,
  ): Promise<void> {
    const defaultBranch = await this.getDefaultBranch(repoPath);
    try {
      await portalGitService.runGitCommand([GIT_CMD_BRANCH, "-D", branch]);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("used by worktree") && !errorMessage.includes("checked out")) {
        throw error;
      }

      try {
        const currentBranchResult = await portalGitService.runGitCommand([GIT_CMD_BRANCH, "--show-current"]);
        const currentBranch = currentBranchResult.output.trim();

        if (currentBranch === branch) {
          await portalGitService.runGitCommand(["checkout", defaultBranch]);
        } else {
          const worktreePath = await this.findWorktreePathForBranch(portalGitService, branch);
          if (worktreePath) {
            const mainWorktreeResult = await portalGitService.runGitCommand([
              GIT_CMD_WORKTREE,
              GIT_CMD_LIST,
              "--porcelain",
            ]);
            const mainWorktree = mainWorktreeResult.output.trim().split("\n")[0];
            if (mainWorktree && mainWorktree.includes(worktreePath)) {
              await portalGitService.runGitCommand(["checkout", defaultBranch]);
            } else {
              await portalGitService.runGitCommand([GIT_CMD_WORKTREE, "remove", "--force", worktreePath]);
            }
          }
        }

        await portalGitService.runGitCommand([GIT_CMD_BRANCH, "-D", branch]);
      } catch (worktreeError) {
        const wtErrorMessage = worktreeError instanceof Error ? worktreeError.message : String(worktreeError);
        throw new Error(
          `Failed to delete branch: ${errorMessage}\n` +
            `Attempted to resolve checkout/worktree conflict but failed: ${wtErrorMessage}\n` +
            `Try manually checking out a different branch and then deleting: git checkout ${defaultBranch} && git branch -D ${branch}`,
        );
      }
    }
  }

  private async findWorktreePathForBranch(
    portalGitService: Pick<IGitService, "runGitCommand">,
    branch: string,
  ): Promise<string | null> {
    const worktreeList = await portalGitService.runGitCommand([GIT_CMD_WORKTREE, GIT_CMD_LIST, "--porcelain"]);
    const worktrees = worktreeList.output.trim().split("\n");

    for (let i = 0; i < worktrees.length; i++) {
      const line = worktrees[i];
      if (!line.startsWith("worktree ")) continue;

      const path = line.substring("worktree ".length);
      for (let j = i + 1; j < worktrees.length && j < i + 4; j++) {
        if (!worktrees[j].startsWith("branch ")) continue;
        const branchRef = worktrees[j].substring("branch ".length);
        const branchName = branchRef.startsWith("refs/heads/")
          ? branchRef.substring("refs/heads/".length)
          : branchRef.split("/").pop();
        if (branchName === branch) {
          return path;
        }
      }
    }

    return null;
  }
}
