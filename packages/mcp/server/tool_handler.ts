/**
 * @module ToolHandler
 * @path packages/mcp/server/tool_handler.ts
 * @description Base class for all MCP tool handlers, providing common validation, security, and logging.
 * @architectural-layer MCP
 * @related-files ["packages/portal/src/portal_permissions.ts", packages/mcp/server/handlers/read_file_tool.ts, packages/mcp/server/handlers/write_file_tool.ts]
 */
import { join, normalize, relative } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { MCPContent, MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";
import type { PortalOperation, ToolErrorCode } from "@exaix/core";
import { type LogMetadata, toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

/**
 * Base class for all MCP tool handlers
 * Provides common validation and logging functionality
 */
export abstract class ToolHandler {
  protected context: ICliApplicationContext;
  protected config: Config;
  protected db: IDatabaseService;
  protected logger?: IEventLogger;
  protected permissions: IPortalPermissionsChecker | null;

  constructor(context: ICliApplicationContext, permissions?: IPortalPermissionsChecker, logger?: IEventLogger) {
    this.context = context;
    this.config = context.config.getAll();
    this.db = context.db;
    this.logger = logger;
    this.permissions = permissions || null;
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
   * Resolves a portal-relative path to absolute filesystem path
   * Validates the resolved path stays within portal bounds
   */
  protected resolvePortalPath(portalPath: string, relativePath: string): string {
    this.validatePathSafety(relativePath);
    const absolutePath = join(portalPath, relativePath);
    const relativeFromPortal = relative(portalPath, absolutePath);

    // Ensure resolved path is still within portal
    if (relativeFromPortal.startsWith("..")) {
      throw new Error("Path traversal not allowed. Resolved path escapes portal.");
    }

    return absolutePath;
  }

  /**
   * Logs tool execution to IActivity Journal
   */
  protected logToolExecution(
    toolName: string,
    portal: string,
    identityId: string,
    metadata: LogMetadata,
  ): void {
    const action = `mcp.tool.${toolName}`;
    if (this.logger) {
      void this.logger.info(action, portal, metadata);
      return;
    }
    const actor = `identity:${identityId}`;
    this.db.logActivity(
      actor,
      action,
      portal,
      toSafeJson(metadata) as Record<string, JSONValue>,
      undefined,
      "identity",
      identityId,
    );
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
    _code: ToolErrorCode,
    message: string,
    metadata: LogMetadata,
  ): MCPToolResponse {
    this.logToolExecution(toolName, portal, identityId, {
      ...metadata,
      success: false,
      error: message,
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
