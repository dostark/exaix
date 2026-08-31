/**
 * @module IWorkspaceExecutionContext
 * @path packages/portal/src/context/workspace_execution_context.ts
 * @description Defines the environment for agent operations, including working
 * directories, repository paths, and security boundaries.
 *
 * Key Concepts:
 * - Portal Execution vs Workspace Execution boundaries
 * - Git operations always target the configured repository
 * - File access is restricted to allowed paths to prevent traversal
 *
 * @architectural-layer Services
 * @related-files ["packages/request/src/router.ts", "packages/execution/src/execution_loop.ts"]
 */

import { join, normalize } from "@std/path";
import type { IPortalConfig } from "@exaix/schemas";

import { existsSync } from "@std/fs";

export interface IWorkspaceExecutionContext {
  /** Working directory for agent execution */
  workingDirectory: string;

  /** Git repository for version control operations */
  gitRepository: string;

  /** Allowed file paths for agent access */
  allowedPaths: string[];

  /** Repository for review tracking */
  reviewRepo: string;

  /** Portal alias (if executing in portal) */
  portal?: string;

  /** Portal target path (resolved symlink) */
  portalTarget?: string;
}

/**
 * Builder for creating execution contexts
 */
export class WorkspaceExecutionContextBuilder {
  static forPortal(portal: IPortalConfig): IWorkspaceExecutionContext {
    const portalTarget = normalize(portal.target_path.replace(/\/$/, ""));
    const gitDir = join(portalTarget, ".git");

    return {
      workingDirectory: portalTarget,
      gitRepository: gitDir,
      allowedPaths: [portalTarget],
      reviewRepo: gitDir,
      portal: portal.alias,
      portalTarget,
    };
  }

  static forWorkspace(workspacePath: string): IWorkspaceExecutionContext {
    const normalizedPath = normalize(workspacePath.replace(/\/$/, ""));
    const gitDir = join(normalizedPath, ".git");

    return {
      workingDirectory: normalizedPath,
      gitRepository: gitDir,
      allowedPaths: [normalizedPath],
      reviewRepo: gitDir,
    };
  }

  static validatePortalExists(portal: IPortalConfig): void {
    const portalTarget = normalize(portal.target_path.replace(/\/$/, ""));
    if (!existsSync(portalTarget)) {
      throw new Error(`Portal target path does not exist: ${portalTarget}`);
    }
  }

  static validatePortalGitRepo(portal: IPortalConfig): void {
    const portalTarget = normalize(portal.target_path.replace(/\/$/, ""));
    const gitDir = join(portalTarget, ".git");
    if (!existsSync(gitDir)) {
      throw new Error(`Portal does not contain a git repository: ${portalTarget}`);
    }
  }

  static validateWorkspaceExists(workspacePath: string): void {
    const normalizedPath = normalize(workspacePath.replace(/\/$/, ""));
    if (!existsSync(normalizedPath)) {
      throw new Error(`Workspace directory does not exist: ${normalizedPath}`);
    }
  }

  static validateWorkspaceGitRepo(workspacePath: string): void {
    const normalizedPath = normalize(workspacePath.replace(/\/$/, ""));
    const gitDir = join(normalizedPath, ".git");
    if (!existsSync(gitDir)) {
      throw new Error(`Workspace does not contain a git repository: ${normalizedPath}`);
    }
  }

  static async resolvePortalSymlink(portal: IPortalConfig): Promise<IPortalConfig> {
    const realPath = await Deno.realPath(portal.target_path);
    return {
      ...portal,
      target_path: realPath,
    };
  }
}
