/**
 * @module PathResolver
 * @path packages/portal/src/path_resolver.ts
 * @description Resolves portal alias paths (e.g., @Blueprints/) to absolute system paths,
 * enforcing security boundaries to prevent path traversal.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", packages/core/src/config/service.ts]
 */
import { join } from "@std/path";
import type { Config } from "@exaix/schemas";

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_UNKNOWN_LABEL } from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";

export interface IPathResolverConfig {
  /** Optional: Event logger for activity and security event routing */
  logger?: IEventLogger;

  /** Optional: Trace ID for logging */
  traceId?: string;
}

export class PathResolver {
  private config: Config;
  private logger?: IEventLogger;
  private traceId?: string;

  constructor(config: Config, options?: IPathResolverConfig) {
    this.config = config;
    this.logger = options?.logger;
    this.traceId = options?.traceId;
  }

  /**
   * Resolves a portal alias path (e.g., "@Blueprints/agent.md") to an absolute system path.
   * Enforces security boundaries to prevent path traversal.
   */
  async resolve(aliasPath: string): Promise<string> {
    const startTime = Date.now();

    try {
      if (!aliasPath.startsWith("@")) {
        this.logSecurityViolation(DomainEventType.PathInvalidAlias, aliasPath, "Path must start with @ alias");
        throw new Error("Path must start with a portal alias (e.g., @Blueprints/)");
      }

      // Split alias and relative path
      const parts = aliasPath.split("/");
      const alias = parts[0];
      const relativePath = parts.slice(1).join("/");

      const root = this.resolveAliasRoot(alias);
      const fullPath = join(root, relativePath);

      // Validate security
      const resolvedPath = await this.validatePath(fullPath, [root]);

      const duration = Date.now() - startTime;

      // Log successful resolution
      this.logActivity(DEFAULT_MCP_IDENTITY_ID, DomainEventType.PathResolved, aliasPath, {
        alias,
        resolved_path: resolvedPath,
        duration_ms: duration,
      });

      return resolvedPath;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log resolution failure
      this.logActivity(DEFAULT_MCP_IDENTITY_ID, DomainEventType.PathResolutionFailed, aliasPath, {
        duration_ms: duration,
        error_type: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
        error_message: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  private resolveAliasRoot(alias: string): string {
    const { system, paths } = this.config;

    // Map aliases to config paths
    // We resolve these relative to system.root
    switch (alias) {
      case "@Runtime":
        return join(system.root, paths.runtime);
      case "@Memory":
        return join(system.root, paths.memory);
      case "@Portals":
        return join(system.root, paths.portals);
      case "@Blueprints":
        return join(system.root, paths.blueprints);
      case "@Workspace":
        return join(system.root, paths.workspace);
      default: {
        // Check for user-defined portals
        const portalAlias = alias.startsWith("@") ? alias.substring(1) : alias;
        const portal = this.config.portals.find((p) => p.alias === portalAlias);
        if (portal) {
          return portal.target_path;
        }
        throw new Error(`Unknown portal alias: ${alias}`);
      }
    }
  }

  /**
   * Validates that a path is within allowed roots.
   *
   * Security (Finding 8): resolves symlinks on BOTH the root and the target before
   * the within-root check. The physical target is `Deno.realPath` of the path (or, for
   * a not-yet-existing path, the realpath of its nearest existing ancestor). A string
   * prefix check is insufficient because an in-portal symlink pointing outside the
   * portal would otherwise pass.
   */
  private async validatePath(path: string, allowedRoots: string[]): Promise<string> {
    const normalizedPath = join(path);
    const physicalPath = await this.resolvePhysicalPath(normalizedPath);

    for (const root of allowedRoots) {
      // Resolve the physical root (follows symlinks).
      const realRoot = await Deno.realPath(root);
      if (physicalPath === realRoot || physicalPath.startsWith(realRoot + "/")) {
        // Return the resolved normalized path (existing callers expect a usable path).
        return normalizedPath;
      }
    }

    // Full detail (absolute paths) goes to the operator journal only; the caller-facing
    // message is generic so it does not disclose host filesystem layout (Finding 10).
    this.logSecurityViolation(
      DomainEventType.PathAccessDenied,
      path,
      `Path ${path} resolves to ${physicalPath}, which is outside allowed roots`,
    );
    throw new Error("Access denied: path is outside the allowed portal roots.");
  }

  /**
   * Resolves a path to its physical location, following symlinks. For a path that does
   * not exist yet, resolves the nearest existing ancestor and re-appends the remainder,
   * so a symlinked ancestor is still detected.
   */
  private async resolvePhysicalPath(target: string): Promise<string> {
    try {
      return await Deno.realPath(target);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const parent = join(target, "..");
      if (parent === target) return target;
      const realParent = await this.resolvePhysicalPath(parent);
      return join(realParent, target.slice(target.lastIndexOf("/") + 1));
    }
  }

  /**
   * Log activity to IActivity Journal
   */
  private logActivity(
    _actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
  ): void {
    if (!this.logger) return;
    void this.logger.info(actionType, target, payload, this.traceId);
  }

  /**
   * Log security violations with high priority
   */
  private logSecurityViolation(
    actionType: string,
    path: string,
    reason: string,
  ): void {
    if (!this.logger) {
      console.warn(`[SECURITY] ${actionType}: ${path} - ${reason}`);
      return;
    }
    void this.logger.warn(actionType, path, {
      reason,
      severity: "high",
      timestamp: new Date().toISOString(),
    }, this.traceId);
  }
}
