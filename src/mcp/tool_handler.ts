/**
 * @module ToolHandler
 * @path src/mcp/tool_handler.ts
 * @description Base class for all MCP tool handlers, providing common validation, security, and logging.
 * @architectural-layer MCP
 * * @related-files [src/services/portal_permissions.ts, src/mcp/handlers/read_file_tool.ts, src/mcp/handlers/write_file_tool.ts]
 */
import { join, normalize, relative } from "@std/path";
import type { Config } from "../shared/schemas/config.ts";
import type { IDatabaseService } from "../services/core/db.ts";
import type { ICliApplicationContext } from "../cli/cli_context.ts";
import { type MCPToolResponse } from "../shared/schemas/mcp.ts";
import { PortalPermissionsService } from "../services/portal/portal_permissions.ts";
import { PortalOperation } from "../shared/enums.ts";
import { JSONValue, LogMetadata, toSafeJson } from "../shared/types/json.ts";

/**
 * Base class for all MCP tool handlers
 * Provides common validation and logging functionality
 */
export abstract class ToolHandler {
  protected context: ICliApplicationContext;
  protected config: Config;
  protected db: IDatabaseService;
  protected permissions: PortalPermissionsService | null;

  constructor(context: ICliApplicationContext, permissions?: PortalPermissionsService) {
    this.context = context;
    this.config = context.config.getAll();
    this.db = context.db;
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
      // No permissions service configured, allow all operations
      return;
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
    const actor = `identity:${identityId}`;
    this.db.logActivity(
      actor,
      `mcp.tool.${toolName}`,
      portal,
      toSafeJson(metadata) as Record<string, JSONValue>,
      undefined,
      "identity",
      identityId,
    );
  }

  /**
   * Formats a successful tool response with logging
   */
  protected formatSuccess(
    toolName: string,
    portal: string,
    identityId: string,
    message: string,
    metadata: LogMetadata,
  ): MCPToolResponse {
    this.logToolExecution(toolName, portal, identityId, { ...metadata, success: true });
    return {
      content: [{ type: "text", text: message }],
    };
  }

  /**
   * Formats an error response with logging and re-throws
   */
  protected formatError(
    toolName: string,
    portal: string,
    identityId: string,
    error: unknown,
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
