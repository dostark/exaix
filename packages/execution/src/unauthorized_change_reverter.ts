/**
 * @module UnauthorizedChangeReverter
 * @path packages/execution/src/unauthorized_change_reverter.ts
 * @description Reverts unauthorized file changes in a portal with git restore or clean, including the locked atomic audit and revert.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/git_audit_service.ts, packages/execution/tests/git_audit_service_test.ts]
 */

import { gitRevertLimits } from "@exaix/git";
import { join } from "@std/path";
import { SafeSubprocess } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { AgentExecutionError } from "@exaix/execution";
import { validatePortalFilePath } from "./portal_file_path.ts";

/** Reverts the files that a step changed without authorization, with git timeouts on every call. */
export class UnauthorizedChangeReverter {
  constructor(private logger: IEventLogger) {}

  /**
   * Revert unauthorized file changes using git restore/clean.
   */
  async revertUnauthorizedChanges(
    portalPath: string,
    unauthorizedFiles: string[],
  ): Promise<void> {
    if (unauthorizedFiles.length === 0) return;

    const validatedFiles = unauthorizedFiles
      .map((file) => validatePortalFilePath(file, portalPath))
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

    const limits = gitRevertLimits();
    const results = { successful: [] as string[], failed: [] as Array<{ file: string; error: string }> };
    const chunks = this.chunkArray(validatedFiles, limits.concurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(async (file) => {
        try {
          const lsResult = await SafeSubprocess.run("git", ["ls-files", "--error-unmatch", file], {
            cwd: portalPath,
            timeoutMs: limits.lsFilesTimeoutMs,
          });
          if (lsResult.code === 0) {
            const restoreResult = await SafeSubprocess.run("git", ["restore", "--source=HEAD", "--", file], {
              cwd: portalPath,
              timeoutMs: limits.checkoutTimeoutMs,
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
              timeoutMs: limits.checkoutTimeoutMs,
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

  /** Atomic — performs git status check and file reversion in a single locked operation
   *  to prevent TOCTOU race conditions. */
  async auditAndRevertChanges(
    portalPath: string,
    authorizedFiles: string[],
  ): Promise<{ reverted: string[]; failed: string[] }> {
    const limits = gitRevertLimits();
    const lockFile = join(portalPath, ".exa-git-lock");
    const lock = await this.acquireLock(lockFile);

    try {
      const result = await SafeSubprocess.run("git", [
        "ls-files",
        "--modified",
        "--others",
        "--deleted",
        "--exclude-standard",
        ".",
      ], {
        cwd: portalPath,
        timeoutMs: limits.statusTimeoutMs,
      });

      if (result.code !== 0) {
        throw new Error(`Git audit failed: ${result.stderr}`);
      }

      const fileList = result.stdout;
      if (!fileList) {
        return { reverted: [], failed: [] };
      }

      const results = { reverted: [] as string[], failed: [] as string[] };
      const _authorizedSet = new Set(authorizedFiles);

      for (const line of fileList.split("\n")) {
        const filename = line.trim();
        if (!filename) continue;
        if (filename === ".exa-git-lock") continue;

        const validated = validatePortalFilePath(filename, portalPath);
        if (!validated) continue;

        if (_authorizedSet.has(filename)) continue;

        results.failed.push(filename);

        try {
          const stat = await Deno.lstat(join(portalPath, filename));
          if (stat.isSymlink) {
            await this.logger.error(DomainEventType.SecuritySymlinkDetected, portalPath, { filename });
            continue;
          }
        } catch {
          void 0;
        }

        try {
          const lsResult = await SafeSubprocess.run("git", ["ls-files", "--error-unmatch", validated], {
            cwd: portalPath,
            timeoutMs: limits.lsFilesTimeoutMs,
          });

          if (lsResult.code === 0) {
            await SafeSubprocess.run("git", ["restore", "--source=HEAD", "--", validated], {
              cwd: portalPath,
              timeoutMs: limits.checkoutTimeoutMs,
            });
            results.reverted.push(filename);
          } else {
            await SafeSubprocess.run("git", ["clean", "-f", "--", validated], {
              cwd: portalPath,
              timeoutMs: limits.cleanTimeoutMs,
            });
            results.reverted.push(filename);
          }
        } catch (error) {
          console.error(`Failed to revert unauthorized change to ${filename}:`, error);
        }
      }

      return results;
    } finally {
      await lock.release();
    }
  }

  private async acquireLock(lockFile: string): Promise<{ release: () => Promise<void> }> {
    const maxRetries = 10;
    const retryDelay = 100;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await Deno.open(lockFile, {
          write: true,
          create: true,
          createNew: true,
        });

        return {
          release: async () => {
            try {
              await Deno.remove(lockFile);
            } catch {
              void 0;
            }
          },
        };
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) {
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to acquire git lock after maximum retries");
  }
}
