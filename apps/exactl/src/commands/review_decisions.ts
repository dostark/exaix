/**
 * @module ReviewDecisions
 * @path apps/exactl/src/commands/review_decisions.ts
 * @description Approves or rejects a review of the exactl review command: the merge, the branch and worktree cleanup and the rejection record.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/review_commands.ts]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { ValidationChain } from "@exaix/cli/validation/validation_chain.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";
import { ReviewStatus } from "@exaix/core/status";
import type { IReviewStatus } from "@exaix/core/status";
import type { IArtifactWithContent } from "@exaix/schemas/artifact.ts";
import type { IGitService, Opt, Reason } from "@exaix/core/types";
import {
  GIT_CMD_BRANCH,
  GIT_CMD_CHECKOUT,
  GIT_CMD_LIST,
  GIT_CMD_REV_PARSE,
  GIT_CMD_WORKTREE,
} from "@exaix/git/constants.ts";
import type { IReviewDetails } from "./review_commands.ts";

/** What the review decisions take from the review command that owns them. */
export interface IReviewDecisionsCallbacks {
  readonly createPortalGitService: (repoPath: string, traceId: string) => Promise<Pick<IGitService, "runGitCommand">>;
  readonly findRepoForBranch: (branchName: string) => Promise<string>;
  readonly getArtifact: (artifactId: string) => Promise<IArtifactWithContent>;
  readonly getDefaultBranch: (repoPath: string) => Promise<string>;
  readonly isArtifactId: (id: string) => boolean;
  readonly resolveBaseBranchForBranch: (
    branch: string,
    repoPath: string,
    fallbackDefaultBranch: string,
  ) => Promise<string>;
  readonly show: (branchName: string) => Promise<IReviewDetails>;
  readonly updateArtifactStatus: (
    artifactId: string,
    status: Exclude<IReviewStatus, typeof ReviewStatus.PENDING>,
    reason?: Opt<string, Reason.OptionalInput>,
  ) => Promise<void>;
}

/** Approves and rejects a review, merging or deleting the branch and cleaning up its worktree. */
export class ReviewDecisions extends BaseCommand {
  private readonly createPortalGitService: (
    repoPath: string,
    traceId: string,
  ) => Promise<Pick<IGitService, "runGitCommand">>;
  private readonly findRepoForBranch: (branchName: string) => Promise<string>;
  private readonly getArtifact: (artifactId: string) => Promise<IArtifactWithContent>;
  private readonly getDefaultBranch: (repoPath: string) => Promise<string>;
  private readonly isArtifactId: (id: string) => boolean;
  private readonly resolveBaseBranchForBranch: (
    branch: string,
    repoPath: string,
    fallbackDefaultBranch: string,
  ) => Promise<string>;
  private readonly show: (branchName: string) => Promise<IReviewDetails>;
  private readonly updateArtifactStatus: (
    artifactId: string,
    status: Exclude<IReviewStatus, typeof ReviewStatus.PENDING>,
    reason?: Opt<string, Reason.OptionalInput>,
  ) => Promise<void>;

  constructor(context: ICommandContext, callbacks: IReviewDecisionsCallbacks) {
    super(context);
    this.createPortalGitService = callbacks.createPortalGitService;
    this.findRepoForBranch = callbacks.findRepoForBranch;
    this.getArtifact = callbacks.getArtifact;
    this.getDefaultBranch = callbacks.getDefaultBranch;
    this.isArtifactId = callbacks.isArtifactId;
    this.resolveBaseBranchForBranch = callbacks.resolveBaseBranchForBranch;
    this.show = callbacks.show;
    this.updateArtifactStatus = callbacks.updateArtifactStatus;
  }

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
        // A failed merge must not leave the repo conflicted or orphan the worktree checkout.
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

      // Only worktree-based reviews are cleaned up. Branch-based reviews stay unchanged.
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

  /** Reject review: delete `branchName` (or request_id) without merging, recording `reason`. */
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
          await portalGitService.runGitCommand([GIT_CMD_CHECKOUT, defaultBranch]);
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

  private async cleanupWorktreeReview(
    portalGitService: Pick<IGitService, "runGitCommand">,
    review: IReviewDetails,
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
    review: IReviewDetails,
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

  private getExecutionWorktreePointerPath(traceId: string): string {
    return join(
      this.config.system.root,
      this.config.paths.memory,
      this.config.paths.memoryExecution,
      traceId,
      GIT_CMD_WORKTREE,
    );
  }

  private async bestEffortLinkRequestRejection(
    requestId: Opt<string, Reason.OptionalContext>,
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
}
