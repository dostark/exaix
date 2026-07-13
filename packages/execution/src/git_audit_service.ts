/**
 * @module GitAuditService
 * @path packages/execution/src/git_audit_service.ts
 * @description Git audit, SHA resolution, file path validation, and
 *   unauthorized change reversion. Extracted from AgentOrchestrator.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import { join } from "@std/path";
import { AgentExecutionErrorType, SafeSubprocess, SubprocessTimeoutError } from "@exaix/core";
import {
  DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
  DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
  DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
  DEFAULT_GIT_REVERT_CONCURRENCY_LIMIT,
  DEFAULT_GIT_STATUS_TIMEOUT_MS,
  GIT_CMD_REV_PARSE,
  GIT_CMD_STATUS,
  GIT_EMPTY_SHA,
} from "@exaix/git";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { AgentExecutionError } from "@exaix/execution";

/**
 * Git audit, file path validation, and unauthorized change reversion.
 * All git operations use SafeSubprocess with timeout guards.
 */
export class GitAuditService {
  constructor(private logger: IEventLogger) {}

  /**
   * Audit git changes to detect unauthorized modifications.
   * Returns list of file paths that were changed without authorization.
   */
  async auditGitChanges(portalPath: string, authorizedFiles: string[]): Promise<string[]> {
    try {
      const checkRepo = await SafeSubprocess.run("git", [GIT_CMD_REV_PARSE, "--is-inside-work-tree"], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      if (checkRepo.code !== 0) return [];

      const result = await SafeSubprocess.run("git", [GIT_CMD_STATUS, "--porcelain"], {
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

  /**
   * Validate file path for security — prevents path traversal and injection.
   * Returns the validated path or null if invalid.
   */
  validateFilePath(filePath: string, portalPath: string): string | null {
    const normalizedPath = this.normalizeAndPreValidateFilePath(filePath);
    if (!normalizedPath) return null;

    const combinedPath = join(portalPath, normalizedPath);
    try {
      const resolved = Deno.realPathSync(combinedPath);
      if (!resolved.startsWith(portalPath)) {
        return null;
      }
      return normalizedPath;
    } catch {
      return null;
    }
  }

  /**
   * Normalize and pre-validate a file path for security.
   */
  private normalizeAndPreValidateFilePath(filePath: string): string | null {
    if (filePath.startsWith("/")) return null;
    if (filePath.startsWith("../")) return null;
    if (filePath.includes("..")) return null;

    const normalizedPath = filePath.replace(/\\/g, "/");
    if (normalizedPath.includes("..")) return null;

    const decodedPath = decodeURIComponent(normalizedPath);
    if (decodedPath !== normalizedPath) return null;

    return normalizedPath;
  }

  /**
   * Revert unauthorized file changes using git restore/clean.
   */
  async revertUnauthorizedChanges(
    portalPath: string,
    unauthorizedFiles: string[],
  ): Promise<void> {
    if (unauthorizedFiles.length === 0) return;

    const validatedFiles = unauthorizedFiles
      .map((file) => this.validateFilePath(file, portalPath))
      .filter((file): file is string => file !== null);

    if (validatedFiles.length === 0) {
      await this.logger.log({
        action: DomainEventType.SecurityFileValidationFilteredAll,
        target: portalPath,
        payload: {
          original_count: unauthorizedFiles.length,
          reason: "All files contained potentially malicious paths",
        },
      });
      return;
    }

    const results = { successful: [] as string[], failed: [] as Array<{ file: string; error: string }> };
    const chunks = this.chunkArray(validatedFiles, DEFAULT_GIT_REVERT_CONCURRENCY_LIMIT);

    for (const chunk of chunks) {
      const promises = chunk.map(async (file) => {
        try {
          const lsResult = await SafeSubprocess.run("git", ["ls-files", "--error-unmatch", file], {
            cwd: portalPath,
            timeoutMs: DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
          });
          if (lsResult.code === 0) {
            const restoreResult = await SafeSubprocess.run("git", ["restore", "--source=HEAD", "--", file], {
              cwd: portalPath,
              timeoutMs: DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
            });
            if (restoreResult.code === 0) {
              results.successful.push(file);
            } else {
              results.failed.push({
                file,
                error: `git restore failed: ${restoreResult.stderr.trim() || "unknown error"}`,
              });
            }
          } else {
            const cleanResult = await SafeSubprocess.run("git", ["clean", "-f", file], {
              cwd: portalPath,
              timeoutMs: DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
            });
            if (cleanResult.code === 0) {
              results.successful.push(file);
            } else {
              results.failed.push({ file, error: `git clean failed: ${cleanResult.stderr.trim() || "unknown error"}` });
            }
          }
        } catch (error) {
          results.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
      });
      await Promise.all(promises);
    }

    if (results.failed.length > 0) {
      throw new AgentExecutionError(
        `Failed to revert ${results.failed.length} file(s): ${results.failed.map((f) => f.file).join(", ")}`,
      );
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
