/**
 * @module GitHeadResolver
 * @path packages/portal/knowledge/git_head_resolver.ts
 * @description Helper for resolving git HEAD SHA and changed files since a cached commit.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { SafeSubprocess } from "@exaix/core";
import { DEFAULT_GIT_REV_PARSE_TIMEOUT_MS, GIT_CMD_REV_PARSE } from "@exaix/git";

export interface IGitHeadResolver {
  resolve(portalPath: string): Promise<string | null>;
  changedFilesSince(portalPath: string, fromSha: string): Promise<string[] | null>;
}

export class GitHeadResolver implements IGitHeadResolver {
  async resolve(portalPath: string): Promise<string | null> {
    try {
      const result = await SafeSubprocess.run("git", [GIT_CMD_REV_PARSE, "HEAD"], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      return result.code === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  async changedFilesSince(portalPath: string, fromSha: string): Promise<string[] | null> {
    try {
      const result = await SafeSubprocess.run("git", ["diff", "--name-only", fromSha, "HEAD"], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      if (result.code !== 0) return null;

      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return null;
    }
  }
}
