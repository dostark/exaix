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

import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_UNKNOWN_LABEL } from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";

export interface IPathResolverConfig {
  /** Optional: Database service for activity logging (deprecated — prefer logger) */
  db?: IDatabaseService;

  /** Optional: Event logger for activity and security event routing */
  logger?: IEventLogger;

  /** Optional: Trace ID for logging */
  traceId?: string;
}

export class PathResolver {
  private config: Config;
  private db?: IDatabaseService;
  private logger?: IEventLogger;
  private traceId?: string;

  constructor(config: Config, options?: IPathResolverConfig) {
    this.config = config;
    this.db = options?.db;
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
        this.logSecurityViolation("path.invalid_alias", aliasPath, "Path must start with @ alias");
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
      this.logActivity(DEFAULT_MCP_IDENTITY_ID, "path.resolved", aliasPath, {
        alias,
        resolved_path: resolvedPath,
        duration_ms: duration,
      });

      return resolvedPath;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log resolution failure
      this.logActivity(DEFAULT_MCP_IDENTITY_ID, "path.resolution_failed", aliasPath, {
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
   * Uses Deno.realPath to resolve symlinks and .. segments.
   */
  private async validatePath(path: string, allowedRoots: string[]): Promise<string> {
    // 1. Normalize the target path to resolve .. and . segments
    // Note: this does NOT resolve symlinks, but we check against realRoot below
    const normalizedPath = join(path);

    for (const root of allowedRoots) {
      // 2. Resolve the physical root (follows symlinks)
      const realRoot = await Deno.realPath(root);

      // 3. Check if the normalized path is within the real root
      // We also ensure root ends with separator or is exact match
      const isAllowed = normalizedPath === realRoot || normalizedPath.startsWith(realRoot + "/");

      if (isAllowed) {
        return normalizedPath;
      }
    }

    // If we reach here, it's not within any allowed root
    this.logSecurityViolation(
      "path.access_denied",
      path,
      `Path ${path} resolves to ${normalizedPath}, which is outside allowed roots`,
    );
    throw new Error(`Access denied: Path ${path} is outside allowed roots.`);
  }

  /**
   * Log activity to IActivity Journal
   */
  private logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
  ): void {
    if (this.logger) {
      void this.logger.info(actionType, target, payload, this.traceId);
      return;
    }

    if (!this.db) {
      return;
    }

    try {
      this.db.logActivity(actor, actionType, target, payload, this.traceId, null);
    } catch (error) {
      console.error("[PathResolver] Failed to log activity:", error);
    }
  }

  /**
   * Log security violations with high priority
   */
  private logSecurityViolation(
    actionType: string,
    path: string,
    reason: string,
  ): void {
    if (this.logger) {
      void this.logger.warn(actionType, path, {
        reason,
        severity: "high",
        timestamp: new Date().toISOString(),
      }, this.traceId);
      return;
    }

    if (!this.db) {
      console.warn(`[SECURITY] ${actionType}: ${path} - ${reason}`);
      return;
    }

    try {
      this.db.logActivity(
        DEFAULT_MCP_IDENTITY_ID,
        actionType,
        path,
        {
          reason,
          severity: "high",
          timestamp: new Date().toISOString(),
        },
        this.traceId,
        null,
      );
    } catch (error) {
      console.error("[PathResolver] Failed to log security violation:", error);
    }
  }
}
