/**
 * @module ReviewCommands
 * @path apps/exactl/src/commands/review_commands.ts
 * @description Provides CLI commands for reviewing agent-generated changes, including approval/rejection of code branches and artifacts.
 * @architectural-layer CLI
 * @related-files ["packages/core/src/status/review_status.ts", "apps/daemon/main.ts"]
 */

import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { RequestCommands } from "./request_commands.ts";
import { PlanCommands } from "./plan_commands.ts";
import { isReviewStatus, ReviewStatus } from "@exaix/core/status";
import type { IReviewStatus } from "@exaix/core/status";
import type { IArtifact, IArtifactWithContent } from "@exaix/schemas/artifact.ts";
import { type LintCheckRunOutcome, type LintErrorClass, VerificationStatus } from "@exaix/schemas";
import { projectReviewVerification } from "./review_verification.ts";
import type { IGitService, Opt, Reason } from "@exaix/core/types";
import { type ArtifactSubtype, ReviewType, ReviewTypeFilter as ReviewFilterEnum } from "@exaix/core";
import { classifyTraceAnomalies, summarizeAnomalies } from "@exaix/core/events";
import type { IAnomalyFinding, IAnomalySummary } from "@exaix/core/events";
import { GitBranchName } from "@exaix/git";
import { createGitService } from "../../../../apps/common/adapters/git_adapter.ts";
import { GIT_CMD_DIFF, GIT_CMD_REV_PARSE } from "@exaix/git/constants.ts";
import { ReviewListing } from "./review_listing.ts";
import { ReviewDecisions } from "./review_decisions.ts";

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
  agent_role: string;
  // Request context
  request_subject?: string;
  request_agent_role?: string;
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
  // Anomaly context
  anomalySummary?: IAnomalySummary;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  subject?: string;
}

export interface IReviewDetails extends IReviewMetadata {
  diff: string;
  commits: Array<{
    sha: string;
    message: string;
    timestamp: string;
  }>;
  anomalies?: IAnomalyFinding[];
  /** Post-execution verification outcome from the trace's execution.completed row. */
  verification_status?: VerificationStatus;
  /** Validated terminal lint findings summary of the review run. */
  lint?: IReviewLintSummary;
}

/** One configured lint check outcome in the review. */
interface IReviewLintCheck {
  check_index: number;
  outcome: `${LintCheckRunOutcome}`;
  total: number | null;
  error_class: LintErrorClass | null;
}

/** The validated terminal lint summary of one review run. */
export interface IReviewLintSummary {
  total: number | null;
  findings: Array<{ file: string; line: number; rule: string }>;
  truncated: boolean;
  checks: IReviewLintCheck[];
  /** True when the completed run has no loadable final snapshot. */
  unavailable?: boolean;
}

/** Formats the review lint summary as display-safe lines. */
export function formatLintSummary(summary: IReviewLintSummary): string[] {
  if (summary.unavailable === true) return ["lint: lint details unavailable"];
  if (summary.total === 0) return ["lint: no findings remain"];
  const lines = [
    summary.total === null ? "lint: findings count incomplete" : `lint: ${summary.total} remaining finding(s)`,
  ];
  for (const finding of summary.findings) lines.push(`  ${finding.file}:${finding.line} ${finding.rule}`);
  if (summary.truncated && summary.total !== null) {
    lines.push(`  (${summary.total - summary.findings.length} more not listed)`);
  }
  const incomplete = summary.checks.filter((check) =>
    check.outcome === "not_run" || check.outcome === VerificationStatus.ERROR
  );
  for (const check of incomplete) {
    if (check.error_class !== null) {
      lines.push(`  ${check.error_class}: verification could not complete; check the policy and source.`);
    }
  }
  if (incomplete.length > 0) lines.push("  (coverage incomplete)");
  return lines;
}

export type ReviewTypeFilter = ReviewFilterEnum;

/** Verification outcomes a reviewer must be warned about before approving. */
const WARNED_VERIFICATION_STATUSES: readonly string[] = [VerificationStatus.FAILED, VerificationStatus.ERROR];

/** A reviewer warning for a failed or errored post-execution verification, else undefined. */
export function verificationWarning(
  status: Opt<VerificationStatus, Reason.OptionalInput>,
): string | undefined {
  if (!status || !WARNED_VERIFICATION_STATUSES.includes(status)) return undefined;
  return `post-execution verification ${status}: the committed change did not pass its configured checks`;
}

/** The generic note for a completed lint run without a loadable snapshot. */
function unavailableLint(): IReviewLintSummary {
  return { total: null, findings: [], truncated: false, checks: [], unavailable: true };
}

/** True when text carries no raw control character that could spoof a terminal. */
export function isDisplaySafeText(value: string): boolean {
  return ![...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

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
/** The discriminator of a resolved review branch target. */
const REVIEW_TARGET_BRANCH = "branch";

/** The discriminator of a resolved review artifact target. */
const REVIEW_TARGET_ARTIFACT = "artifact";

export class ReviewCommands extends BaseCommand {
  private requestCommands: RequestCommands;
  private decisions: ReviewDecisions;
  private listing: ReviewListing;
  private planCommands: PlanCommands;

  constructor(context: ICommandContext) {
    super(context);
    this.requestCommands = new RequestCommands(context);
    this.planCommands = new PlanCommands(context);
    this.decisions = new ReviewDecisions(context, {
      createPortalGitService: (...args) => this.createPortalGitService(...args),
      findRepoForBranch: (...args) => this.findRepoForBranch(...args),
      getArtifact: (...args) => this.getArtifact(...args),
      getDefaultBranch: (...args) => this.getDefaultBranch(...args),
      isArtifactId: (id) => this.isArtifactId(id),
      resolveBaseBranchForBranch: (...args) => this.resolveBaseBranchForBranch(...args),
      show: (...args) => this.show(...args),
      updateArtifactStatus: (...args) => this.updateArtifactStatus(...args),
    });
    this.listing = new ReviewListing(
      context,
      (...args) => this.getDefaultBranch(...args),
      (...args) => this.getStoredReviewTraceId(...args),
      (...args) => this.getStoredReviewWorktreePath(...args),
      (...args) => this.resolveBaseBranchForBranch(...args),
    );
  }

  /** Approves a review by merging its branch. */
  approve(branchName: string): Promise<void> {
    return this.decisions.approve(branchName);
  }

  /** Rejects a review without merging, recording the reason. */
  reject(branchName: string, reason: string): Promise<void> {
    return this.decisions.reject(branchName, reason);
  }

  private isArtifactId(id: string): boolean {
    return id.startsWith("artifact-");
  }

  private normalizeTypeFilter(
    typeFilter?: Opt<string, Reason.QueryFilter>,
  ): ReviewTypeFilter {
    if (!typeFilter) return ReviewFilterEnum.ALL;
    const normalized = typeFilter.toLowerCase();

    if (normalized === "code") return ReviewFilterEnum.CODE;
    if (normalized === "artifact") return ReviewFilterEnum.ARTIFACT;
    if (normalized === "all") return ReviewFilterEnum.ALL;

    return ReviewFilterEnum.ALL;
  }

  private normalizeStatusFilter(
    statusFilter?: Opt<string, Reason.QueryFilter>,
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

  private async findRepoForBranch(branchName: string): Promise<string> {
    const portalPaths = await this.listing.scanPortalDirectory();

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
      agentRole: await this.getUserIdentity(),
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
      agent_role: string;
      portal: string | null;
      target_branch: string | null;
      created: string;
      updated: string | null;
      request_id: string;
      file_path: string;
      rejection_reason: string | null;
    }>(
      `SELECT id, status, type, agent_role, portal, target_branch, created, updated, request_id, file_path, rejection_reason
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
      agent_role: row.agent_role,
      portal: row.portal,
      target_branch: row.target_branch,
      created: row.created,
      updated: row.updated,
      request_id: row.request_id,
      file_path: row.file_path,
      rejection_reason: row.rejection_reason,
    };
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
    reason?: Opt<string, Reason.OptionalInput>,
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

  async list(
    statusFilter?: Opt<string, Reason.QueryFilter>,
    typeFilter?: Opt<string, Reason.QueryFilter>,
  ): Promise<IReviewMetadata[]> {
    const requestedType = this.normalizeTypeFilter(typeFilter);
    const normalizedStatus = this.normalizeStatusFilter(statusFilter);
    const reviews: IReviewMetadata[] = [];

    if (this.listing.shouldIncludeArtifacts(requestedType)) {
      await this.listing.appendArtifactReviews(reviews, normalizedStatus);
    }

    if (!this.listing.shouldIncludeCode(requestedType)) {
      return this.listing.sortReviewsNewestFirst(reviews);
    }

    const dbBranches = new Set<string>();
    await this.listing.appendDbCodeReviews(reviews, dbBranches, normalizedStatus);
    await this.listing.appendGitScannedCodeReviews(reviews, dbBranches, normalizedStatus);

    return this.listing.sortReviewsNewestFirst(reviews);
  }

  private async loadAnomalyPayload(
    traceId: string,
  ): Promise<{
    anomalies?: IAnomalyFinding[];
    anomalySummary?: IAnomalySummary;
  }> {
    try {
      const activities = await this.db.getActivitiesByTraceSafe(traceId);
      const findings = classifyTraceAnomalies(activities);
      if (findings.length === 0) return {};
      const summary = summarizeAnomalies(findings);
      const hasLiveAnomalies = summary.high > 0 || summary.medium > 0 || summary.low > 0;
      return {
        anomalies: findings,
        anomalySummary: hasLiveAnomalies || summary.recovered > 0 ? summary : undefined,
      };
    } catch {
      return {};
    }
  }

  async show(branchName: string): Promise<IReviewDetails> {
    if (this.isArtifactId(branchName)) return this.artifactDetailsOf(await this.getArtifact(branchName));
    const target = await this.resolveReviewTarget(branchName);
    if (target.kind === REVIEW_TARGET_ARTIFACT) return target.details;

    const fullBranch = target.branch;
    const repoPath = await this.findRepoForBranch(fullBranch);
    const defaultBranch = await this.getDefaultBranch(repoPath);
    const baseBranch = await this.resolveBaseBranchForBranch(fullBranch, repoPath, defaultBranch);
    const storedWorktreePath = await this.getStoredReviewWorktreePath(fullBranch);
    const storedTraceId = await this.getStoredReviewTraceId(fullBranch);
    await this.assertBranchExists(repoPath, fullBranch);

    const commits = parseCommitHistory(
      await this.gitOutput(repoPath, [
        "log",
        fullBranch,
        "--not",
        baseBranch,
        "--format=%H|||%s|||%aI",
      ]),
    );
    const diff = await this.gitOutput(repoPath, [GIT_CMD_DIFF, `${baseBranch}...${fullBranch}`]);
    const files = (await this.gitOutput(repoPath, [GIT_CMD_DIFF, "--name-only", `${baseBranch}...${fullBranch}`]))
      .trim().split("\n").filter((file) => file);

    const basicMetadata = this.basicMetadataOf(
      fullBranch,
      baseBranch,
      storedWorktreePath,
      files,
      commits,
      storedTraceId,
    );
    const enrichedMetadata = await this.listing.extractReviewMetadataWithContext(basicMetadata);
    const anomalyPayload = await this.loadAnomalyPayload(storedTraceId ?? basicMetadata.trace_id);
    const verification = await this.loadVerificationProjection(
      storedTraceId ?? basicMetadata.trace_id,
      commits[0]?.sha,
      basicMetadata.request_id,
    );
    return {
      ...enrichedMetadata,
      diff,
      commits,
      ...anomalyPayload,
      ...(verification.status ? { verification_status: verification.status } : {}),
      ...(verification.lint ? { lint: verification.lint } : {}),
    };
  }

  /** The review details of one artifact. */
  private artifactDetailsOf(
    artifact: Awaited<ReturnType<ReviewCommands["getArtifact"]>>,
    withFilePath = false,
  ): IReviewDetails {
    const details: IReviewDetails = {
      type: ReviewType.ARTIFACT,
      branch: artifact.id,
      trace_id: artifact.id,
      request_id: artifact.request_id,
      files_changed: 0,
      created_at: artifact.created,
      agent_role: artifact.agent_role,
      portal: artifact.portal ?? undefined,
      status: artifact.status,
      rejection_reason: artifact.rejection_reason ?? undefined,
      approved_at: artifact.status === ReviewStatus.APPROVED ? artifact.updated ?? undefined : undefined,
      rejected_at: artifact.status === ReviewStatus.REJECTED ? artifact.updated ?? undefined : undefined,
      diff: artifact.body,
      commits: [],
    };
    return withFilePath ? { ...details, file_path: artifact.file_path } : details;
  }

  /** Resolves a review name to a branch, an artifact, or a not-found error. */
  private async resolveReviewTarget(
    branchName: string,
  ): Promise<
    { kind: typeof REVIEW_TARGET_BRANCH; branch: string } | {
      kind: typeof REVIEW_TARGET_ARTIFACT;
      details: IReviewDetails;
    }
  > {
    if (branchName.startsWith("feat/")) return { kind: REVIEW_TARGET_BRANCH, branch: branchName };
    const branches = await this.list(undefined, ReviewFilterEnum.CODE);
    const match = branches.find((branch) => branch.request_id === branchName || branch.branch === `feat/${branchName}`);
    if (match) return { kind: REVIEW_TARGET_BRANCH, branch: match.branch };
    const artifacts = await this.listing.listArtifacts();
    const byRequest = artifacts.find((artifact) => artifact.request_id === branchName);
    if (byRequest) {
      return {
        kind: REVIEW_TARGET_ARTIFACT,
        details: this.artifactDetailsOf(await this.getArtifact(byRequest.id), true),
      };
    }
    throw new Error(`Review not found: ${branchName}\nRun 'exactl review list' to see available reviews`);
  }

  /** Rejects a branch that does not exist in the repository. */
  private async assertBranchExists(repoPath: string, branch: string): Promise<void> {
    const output = await new Deno.Command("git", {
      args: [GIT_CMD_REV_PARSE, "--verify", branch],
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) throw new Error(`Branch not found: ${branch}`);
  }

  /** Runs one Git command in the repository and returns its stdout. */
  private async gitOutput(cwd: string, args: string[]): Promise<string> {
    const output = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
    return new TextDecoder().decode(output.stdout);
  }

  /** The branch, request and commit metadata of one review. */
  private basicMetadataOf(
    fullBranch: string,
    baseBranch: string,
    storedWorktreePath: string | null,
    files: readonly string[],
    commits: readonly { sha: string; message: string; timestamp: string }[],
    storedTraceId: string | null,
  ): IReviewMetadata {
    const [, requestId, parsedTraceId] = fullBranch.match(/^feat\/(request-[\w]+)-(.+)$/) ||
      ["", fullBranch, "unknown"];
    return {
      type: ReviewType.CODE,
      branch: fullBranch,
      trace_id: storedTraceId ?? parsedTraceId,
      request_id: requestId,
      base_branch: baseBranch,
      worktree_path: storedWorktreePath ?? undefined,
      files_changed: files.length,
      created_at: commits[commits.length - 1]?.timestamp || new Date().toISOString(),
      agent_role: commits[0]?.sha.substring(0, 8) || "unknown",
    } as IReviewMetadata;
  }

  /** Reads the verification status and the terminal lint snapshot of the review commit. */
  private async loadVerificationProjection(
    traceId: string,
    commitSha: Opt<string, Reason.OptionalInput>,
    requestId: string,
  ): Promise<{ status?: VerificationStatus; lint?: IReviewLintSummary }> {
    try {
      return projectReviewVerification(await this.db.getActivitiesByTraceSafe(traceId), commitSha, requestId);
    } catch {
      return { lint: unavailableLint() };
    }
  }
}

/** Parses one git log line list into review commits. */
function parseCommitHistory(stdout: string): { sha: string; message: string; timestamp: string }[] {
  return stdout.trim().split("\n").filter((line) => line).map((line) => {
    const [sha, message, timestamp] = line.split("|||");
    return { sha, message, timestamp };
  });
}
