/**
 * @module ToolHandler
 * @path packages/mcp/server/tool_handler.ts
 * @description Base class for all MCP tool handlers, providing common validation, security, and logging.
 * @architectural-layer MCP
 * @related-files ["packages/portal/src/portal_permissions.ts", packages-team/mcp-server/handlers/read_file_tool.ts, packages-team/mcp-server/handlers/write_file_tool.ts]
 */
import { join, normalize } from "@std/path";
import { PathSecurity } from "@exaix/tool-runtime";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { IEventJournalReader } from "@exaix/core/events";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { MCPContent, MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";
import type { PortalOperation, ToolErrorCode } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { LogMetadata } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { IGitService } from "@exaix/core/types";

/**
 * Base class for all MCP tool handlers
 * Provides common validation and logging functionality
 */
export abstract class ToolHandler {
  protected context: ICliApplicationContext;
  protected config: Config;
  protected logger?: IEventLogger;
  protected permissions: IPortalPermissionsChecker | null;

  constructor(
    context: ICliApplicationContext,
    permissions?: Opt<IPortalPermissionsChecker, Reason.OptionalDependency>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.context = context;
    this.config = context.config.getAll();
    this.logger = logger;
    this.permissions = permissions || null;
  }

  /**
   * Returns a read-only journal reader backed by the application database.
   * Subclasses that need to query the activity journal should call this method
   * rather than accessing a database service directly.
   */
  protected getJournalReader(): IEventJournalReader {
    const db = this.context.db;
    return {
      getActivitiesByTrace: (traceId: string) => db.getActivitiesByTrace(traceId),
      getActivitiesByTraceSafe: (traceId: string) => db.getActivitiesByTraceSafe(traceId),
      getRecentActivity: (limit?: Opt<number, Reason.QueryFilter>) => db.getRecentActivity(limit),
      queryActivity: (filter) => db.queryActivity(filter),
    } as IEventJournalReader;
  }

  /**
   * Validates that a portal exists in configuration
   * @throws Error if portal not found
   */
  protected validatePortalExists(portalName: string): string {
    const portal = this.config.portals.find((p) => p.alias === portalName);
    if (!portal) {
      throw new Error(`Portal '${portalName}' not found in configuration`);
    }
    return portal.target_path;
  }

  /**
   * Validates that an agent has permission for an operation on a portal
   * @throws Error if permission denied
   */
  protected validatePermission(
    portalName: string,
    identityId: string,
    operation: PortalOperation,
  ): void {
    if (!this.permissions) {
      throw new Error("Permission denied: permissions service not configured");
    }

    const result = this.permissions.checkOperationAllowed(portalName, identityId, operation);
    if (!result.allowed) {
      throw new Error(
        result.reason || `Permission denied for ${operation} on portal ${portalName}`,
      );
    }
  }

  /**
   * Validates path doesn't contain traversal attempts (../)
   * @throws Error if path traversal detected
   */
  protected validatePathSafety(path: string): void {
    const normalized = normalize(path);
    if (normalized.includes("..") || normalized.startsWith("/")) {
      throw new Error("Path traversal not allowed. Use relative paths within portal.");
    }
  }

  /**
   * Resolves a portal-relative path to an absolute filesystem path, enforcing
   * that the resolved path stays within the portal.
   *
   * Security (Finding 3): resolution is realpath-based via
   * {@link PathSecurity.resolveWithinRoots} — symlinks (including the portal root
   * itself) are resolved before the boundary check, so an in-portal symlink that
   * points outside the portal is rejected. String-only `..` checks are insufficient
   * because they never follow symlinks.
   */
  protected async resolvePortalPath(portalPath: string, relativePath: string): Promise<string> {
    this.validatePathSafety(relativePath);
    // Resolve the portal root through any symlinks so legitimate in-portal paths
    // compare correctly against the physical root.
    const realRoot = await Deno.realPath(portalPath);
    return await PathSecurity.resolveWithinRoots(relativePath, [realRoot], realRoot);
  }

  /**
   * Logs tool execution to IActivity Journal
   */
  protected logToolExecution(
    toolName: string,
    portal: string,
    _identityId: string,
    metadata: LogMetadata,
  ): void {
    if (!this.logger) return;
    void this.logger.info(`mcp.tool.${toolName}`, portal, metadata);
  }

  /**
   * Formats a successful tool response with logging.
   * Passes content blocks through directly to the agent.
   */
  protected formatSuccess(
    toolName: string,
    portal: string,
    identityId: string,
    content: MCPContent[],
    metadata: LogMetadata,
  ): MCPToolResponse {
    this.logToolExecution(toolName, portal, identityId, { ...metadata, success: true });
    return { content };
  }

  /**
   * Returns a structured tool-logic error response with isError:true (does not throw).
   * Use for tool-logic failures (permission denied, not found, execution failed).
   * Reserve throws for unrecoverable protocol-level server errors.
   */
  protected formatToolError(
    toolName: string,
    portal: string,
    identityId: string,
    code: ToolErrorCode,
    message: string,
    metadata: LogMetadata,
  ): MCPToolResponse {
    // The code is journalled, not returned: the agent-facing text stays the raw message so
    // handler tests and scenario assertions keep matching on it, while the journal gains the
    // classification each handler already computes.
    this.logToolExecution(toolName, portal, identityId, {
      ...metadata,
      success: false,
      error: message,
      errorCode: code,
    });
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  /**
   * Formats a protocol-level error with logging and re-throws.
   * Use only for unrecoverable server failures, not tool-logic errors.
   */
  protected formatError(
    toolName: string,
    portal: string,
    identityId: string,
    error: Error | string | unknown,
    metadata: LogMetadata,
  ): never {
    this.logToolExecution(toolName, portal, identityId, {
      ...metadata,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  /**
   * Validates that a portal has a git repository
   * @throws Error if .git directory doesn't exist
   */
  protected async validateGitRepository(portalPath: string, portalName: string): Promise<void> {
    try {
      await Deno.stat(join(portalPath, ".git"));
    } catch {
      throw new Error(`Not a git repository: ${portalName}`);
    }
  }

  /**
   * Returns a per-portal IGitService instance from context.gitServiceFactory.
   * Throws an explicit, documented error when the factory is absent — the same
   * detectable failure mode Phase 142 proved for a missing ToolRegistry.
   */
  protected resolveGitService(portalPath: string): IGitService {
    const factory = this.context.gitServiceFactory;
    if (!factory) {
      throw new Error(
        `IGitServiceFactory not available in context — git operations through MCP require ` +
          `a gitServiceFactory to be wired in the composition root`,
      );
    }
    // Trace ID is not available per-call in the MCP context; use the portal path
    // as a scoping key. The daemon path passes a real traceId; this is acknowledged
    // in the plan as an acceptable divergence.
    return factory.createGitService(portalPath, `mcp:${portalPath}`);
  }

  /**
   * Execute the tool with validated arguments
   * Implemented by subclasses
   */
  abstract execute(args: Record<string, JSONValue>): Promise<MCPToolResponse>;

  /**
   * Returns the tool's JSON schema definition
   */
  abstract getToolDefinition(): {
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  };
}
