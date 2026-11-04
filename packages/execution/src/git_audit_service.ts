/**
 * @module GitAuditService
 * @path packages/execution/src/git_audit_service.ts
 * @description Git audit, SHA resolution, file path validation, and
 *   unauthorized change reversion. Extracted from AgentComposer.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_composer.ts]
 */

import { DEFAULT_GIT_DIFF_TIMEOUT_MS, DEFAULT_GIT_LOG_TIMEOUT_MS, DEFAULT_GIT_STATUS_TIMEOUT_MS } from "@exaix/git";

import { AgentExecutionErrorType, SafeSubprocess, SubprocessTimeoutError } from "@exaix/core";
import { DEFAULT_GIT_REV_PARSE_TIMEOUT_MS, GIT_EMPTY_SHA } from "@exaix/git";
import { GIT_CMD_REV_PARSE, GIT_CMD_STATUS, GIT_FLAG_UNTRACKED_FILES_ALL } from "@exaix/git/constants.ts";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { AgentExecutionError } from "@exaix/execution";

import { validatePortalFilePath } from "./portal_file_path.ts";
import { UnauthorizedChangeReverter } from "./unauthorized_change_reverter.ts";

/** All git operations use SafeSubprocess with timeout guards. */
export class GitAuditService {
  private readonly reverter: UnauthorizedChangeReverter;

  constructor(private logger: IEventLogger) {
    this.reverter = new UnauthorizedChangeReverter(logger);
  }

  /** Returns the validated path, or null when it could allow path traversal or injection. */
  validateFilePath(filePath: string, portalPath: string): string | null {
    return validatePortalFilePath(filePath, portalPath);
  }

  /** Reverts unauthorized file changes using git restore and clean. */
  revertUnauthorizedChanges(portalPath: string, unauthorizedFiles: string[]): Promise<void> {
    return this.reverter.revertUnauthorizedChanges(portalPath, unauthorizedFiles);
  }

  /** Performs the git status check and the file reversion in one locked operation. */
  auditAndRevertChanges(
    portalPath: string,
    authorizedFiles: string[],
  ): Promise<{ reverted: string[]; failed: string[] }> {
    return this.reverter.auditAndRevertChanges(portalPath, authorizedFiles);
  }

  /** Returns file paths that were changed without authorization. */
  async auditGitChanges(portalPath: string, authorizedFiles: string[]): Promise<string[]> {
    try {
      const checkRepo = await SafeSubprocess.run("git", [GIT_CMD_REV_PARSE, "--is-inside-work-tree"], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      if (checkRepo.code !== 0) return [];

      const result = await SafeSubprocess.run("git", [GIT_CMD_STATUS, "--porcelain", GIT_FLAG_UNTRACKED_FILES_ALL], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_STATUS_TIMEOUT_MS,
      });
      if (result.code !== 0) throw new Error(`Git status failed: ${result.stderr}`);

      const statusText = result.stdout;
      if (!statusText) return [];

      const unauthorizedChanges: string[] = [];
      const authorizedSet = new Set(authorizedFiles);
      for (const line of statusText.split("\n")) {
        if (!line.trim()) continue;
        const filename = line.slice(3).trim();
        if (!authorizedSet.has(filename)) {
          unauthorizedChanges.push(filename);
        }
      }
      return unauthorizedChanges;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not a git repository")) return [];

      if (error instanceof SubprocessTimeoutError) {
        await this.logger.error(DomainEventType.GitAuditTimeout, portalPath, {
          error: error.message,
          timeout_ms: DEFAULT_GIT_STATUS_TIMEOUT_MS,
        });
        throw new AgentExecutionError(`Git audit timed out for portal: ${portalPath}`);
      }

      await this.logger.error(DomainEventType.GitAuditFailed, portalPath, {
        error: error instanceof Error ? error.message : String(error),
        stderr: (error instanceof Error && "stderr" in error ? (error as Error & { stderr?: string }).stderr : null) ??
          null,
      });
      throw new AgentExecutionError(
        `Git audit failed for portal: ${portalPath}`,
        AgentExecutionErrorType.EXECUTION_ERROR,
        error as Error,
      );
    }
  }

  /**
   * Get the current git HEAD SHA for a portal directory.
   */
  async getPortalHeadSha(portalPath: string): Promise<string> {
    try {
      const result = await SafeSubprocess.run("git", [GIT_CMD_REV_PARSE, "HEAD"], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS * 2,
      });
      if (result.code !== 0) return GIT_EMPTY_SHA;
      return result.stdout.trim();
    } catch {
      return GIT_EMPTY_SHA;
    }
  }

  async getLatestCommitSha(portalPath: string): Promise<string> {
    const result = await SafeSubprocess.run("git", ["log", "-1", "--format=%H"], {
      cwd: portalPath,
      timeoutMs: DEFAULT_GIT_LOG_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      throw new AgentExecutionError(`Failed to get latest commit SHA: ${result.stderr}`);
    }

    return result.stdout.trim();
  }

  async getChangedFiles(portalPath: string): Promise<string[]> {
    const result = await SafeSubprocess.run("git", ["diff", "--name-only"], {
      cwd: portalPath,
      timeoutMs: DEFAULT_GIT_DIFF_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      throw new AgentExecutionError(`Failed to get changed files: ${result.stderr}`);
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
