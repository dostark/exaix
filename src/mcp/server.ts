/**
 * @module McpServer
 * @path src/mcp/server.ts
 * @description core MCP server implementation, handling JSON-RPC transport, tool registration, and security orchestration.
 * @architectural-layer MCP
 * @related-files [src/mcp/tools.ts, src/mcp/resources.ts, src/mcp/prompts.ts]
 */
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "../services/core/db.ts";
import type { ICliApplicationContext } from "../cli/cli_context.ts";
import { MCPConfigSchema, type MCPTool } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core";
import { JsonRpcErrorCode } from "@exaix/core";
import { McpTransportType } from "@exaix/mcp";
import type { ToolHandler } from "./tool_handler.ts";
import { EventBusService } from "@exaix/core/observability/mod.ts";
import { SseHandler } from "../api/sse_handler.ts";
import { GitCommitTool } from "./handlers/git_commit_tool.ts";
import { GitCreateBranchTool } from "./handlers/git_create_branch_tool.ts";
import { GitStatusTool } from "./handlers/git_status_tool.ts";
import { ListDirectoryTool } from "./handlers/list_directory_tool.ts";
import { ReadFileTool } from "./handlers/read_file_tool.ts";
import { WriteFileTool } from "./handlers/write_file_tool.ts";
import { PatchFileTool } from "./handlers/patch_file_tool.ts";
import { DeleteFileTool } from "./handlers/delete_file_tool.ts";
import { MoveFileTool } from "./handlers/move_file_tool.ts";
import { CreateDirectoryTool } from "./handlers/create_directory_tool.ts";
import { RunCommandTool } from "./handlers/run_command_tool.ts";
import { SearchFilesTool } from "./handlers/search_files_tool.ts";
import { ApprovePlanTool, CreateRequestTool, ListPlansTool, QueryJournalTool } from "./domain_tools.ts";
import { discoverAllResources, parsePortalURI } from "./resources.ts";
import { generatePrompt, getPrompts } from "./prompts.ts";
import { logInfo } from "@exaix/core/logger/structured_logger.ts";

type JsonRpcResult = JSONValue | object;
type JsonRpcErrorData = JSONValue | object;
type JsonRpcArguments = Record<string, JSONValue>;
type ErrorPayload = Error | string | object | JSONValue[] | null | undefined;
type ZodErrorCandidate =
  | { constructor?: { name?: string }; errors?: Array<object> }
  | Error
  | string
  | object
  | JSONValue[]
  | null
  | undefined;
type MCPHttpResponse = Response;

/**
 * MCP Server Implementation
 *
 * Phase 2: First tool implementation (read_file)
 *
 * Provides Model Context Protocol interface for agent tool execution.
 * Currently supports:
 * - stdio transport
 * - initialize handshake
 * - tools/list with registered tools
 * - tools/call for read_file
 * - IActivity Journal logging
 *
 * Future phases will add:
 * - Additional tools (write_file, list_directory, git_*)
 * - Resource discovery (portal:// URIs)
 * - Prompt templates (execute_plan, create_review)
 */

interface MCPServerOptions {
  context: ICliApplicationContext;
  transport: McpTransportType;
}

interface JSONRPCRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: Record<string, JSONValue>;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id: number | string;
  result?: JsonRpcResult;
  error?: {
    code: number;
    message: string;
    data?: JsonRpcErrorData;
  };
}

interface InitializeParams {
  protocolVersion: string;
  capabilities: MCPClientCapabilities;
  clientInfo: {
    name: string;
    version: string;
  };
}

/**
 * MCP Client capabilities
 */
interface MCPClientCapabilities {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Prompt arguments key-value map
 */
interface PromptArguments {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Object with constructor property
 */
interface HasConstructor {
  constructor: { name: string };
}

export class MCPServer {
  private context: ICliApplicationContext;
  private config: Config;
  private db: IDatabaseService;
  private transport: McpTransportType;
  private running = false;
  private serverName: string;
  private serverVersion: string;
  private tools: Map<string, ToolHandler> = new Map();
  private sseHandler?: SseHandler;

  constructor(options: MCPServerOptions) {
    this.context = options.context;
    this.config = options.context.config.getAll();
    this.db = options.context.db;
    this.transport = options.transport;

    // Auto-create EventBusService for SSE transport and wire SSE handler
    if (this.transport === McpTransportType.SSE) {
      const eventBus = EventBusService.getInstance();
      this.sseHandler = new SseHandler(eventBus);
    }

    // Validate MCP config
    const mcpConfig = MCPConfigSchema.parse(this.config.mcp);
    this.serverName = mcpConfig.server_name;
    this.serverVersion = mcpConfig.version;

    // Register tools
    this.registerTool(new ReadFileTool(this.context));
    this.registerTool(new WriteFileTool(this.context));
    this.registerTool(new PatchFileTool(this.context));
    this.registerTool(new DeleteFileTool(this.context));
    this.registerTool(new MoveFileTool(this.context));
    this.registerTool(new CreateDirectoryTool(this.context));
    this.registerTool(new ListDirectoryTool(this.context));
    this.registerTool(new GitCreateBranchTool(this.context));
    this.registerTool(new GitCommitTool(this.context));
    this.registerTool(new GitStatusTool(this.context));
    this.registerTool(new CreateRequestTool(this.context));
    this.registerTool(new ListPlansTool(this.context));
    this.registerTool(new ApprovePlanTool(this.context));
    this.registerTool(new QueryJournalTool(this.context));
    this.registerTool(new RunCommandTool(this.context));
    this.registerTool(new SearchFilesTool(this.context));
  }

  /**
   * Registers a tool handler with the server
   */
  private registerTool(tool: ToolHandler): void {
    const definition = tool.getToolDefinition();
    this.tools.set(definition.name, tool);
  }

  /**
   * Starts the MCP server and logs to IActivity Journal
   */
  start(): void {
    if (this.running) {
      throw new Error("MCP Server is already running");
    }

    this.running = true;

    // Log server start
    this.db.logActivity(
      "mcp.server",
      "mcp.server.started",
      null,
      {
        transport: this.transport,
        server_name: this.serverName,
        server_version: this.serverVersion,
      },
    );
  }

  /**
   * Stops the MCP server gracefully and logs to IActivity Journal
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Log server stop
    this.db.logActivity(
      "mcp.server",
      "mcp.server.stopped",
      null,
      {
        server_name: this.serverName,
      },
    );
  }

  /**
   * Returns whether the server is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns the transport type (stdio)
   */
  getTransport(): string {
    return this.transport;
  }

  /**
   * Returns the server name (exaix)
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * Returns the server version (from config)
   */
  getVersion(): string {
    return this.serverVersion;
  }

  /**
   * Handles incoming JSON-RPC 2.0 requests
   *
   * Currently supports:
   * - initialize: Protocol handshake
   * - tools/list: Returns available tools (empty array in Phase 1)
   *
   * Returns JSON-RPC 2.0 response with result or error
   */
  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    // Validate JSON-RPC 2.0 format
    if (!request.jsonrpc || request.jsonrpc !== "2.0") {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: JsonRpcErrorCode.INVALID_REQUEST,
          message: "Invalid JSON-RPC 2.0 request: missing or invalid 'jsonrpc' field",
        },
      };
    }

    // Route to method handlers
    switch (request.method) {
      case "initialize":
        return this.handleInitialize(request);
      case "tools/list":
        return this.handleToolsList(request);
      case "tools/call":
        return await this.handleToolsCall(request);
      case "resources/list":
        return await this.handleResourcesList(request);
      case "resources/read":
        return await this.handleResourcesRead(request);
      case "prompts/list":
        return this.handlePromptsList(request);
      case "prompts/get":
        return this.handlePromptsGet(request);
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: JsonRpcErrorCode.METHOD_NOT_FOUND,
            message: `Method '${request.method}' not found`,
          },
        };
    }
  }

  /**
   * Handles initialize request (MCP protocol handshake)
   */
  private handleInitialize(
    request: JSONRPCRequest,
  ): JSONRPCResponse {
    const params = request.params;
    const clientInfo = params.clientInfo as { name: string; version: string } | undefined;

    // Log initialization
    this.db.logActivity(
      "mcp.server",
      "mcp.initialize",
      clientInfo?.name || null,
      {
        client_version: clientInfo?.version || null,
        protocol_version: params.protocolVersion as string,
      },
    );

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: this.serverName,
          version: this.serverVersion,
        },
        capabilities: {
          tools: {},
          resources: {}, // Phase 4
          prompts: {}, // Phase 4
        },
      },
    };
  }

  /**
   * Handles tools/list request
   * Returns all registered tools with their definitions
   */
  private handleToolsList(
    request: JSONRPCRequest,
  ): JSONRPCResponse {
    const toolDefinitions = Array.from(this.tools.values()).map((tool) => tool.getToolDefinition());

    // Log tools list request
    this.db.logActivity(
      "mcp.server",
      "mcp.tools.list",
      null,
      {
        tool_count: toolDefinitions.length,
      },
    );

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: toolDefinitions as MCPTool[],
      },
    };
  }

  /**
   * Handles tools/call request
   * Executes the specified tool with provided arguments
   */
  private async handleToolsCall(
    request: JSONRPCRequest,
  ): Promise<JSONRPCResponse> {
    const params = request.params as {
      name: string;
      arguments: JsonRpcArguments;
    };

    // Validate tool exists
    const tool = this.tools.get(params.name);
    if (!tool) {
      // Log missing tool attempt
      this.db.logActivity(
        "mcp.server",
        "mcp.tool.not_found",
        params.name,
        { tool_name: params.name },
      );

      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: `Tool '${params.name}' not found`,
        },
      };
    }

    try {
      // Execute tool
      const result = await tool.execute(params.arguments as Record<string, JSONValue>);

      // Log successful tool execution (sanitized)
      try {
        this.db.logActivity(
          "mcp.server",
          "mcp.tool.executed",
          params.name,
          {
            tool_name: params.name,
            success: true,
            has_result: !!result,
          },
        );
      } catch {
        // Logging must not break tool execution
      }

      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    } catch (error) {
      // Classify and sanitize errors for JSON-RPC
      const classification = this.classifyError(error as ErrorPayload);

      // Log error with context (do not include sensitive details)
      try {
        this.db.logActivity(
          "mcp.server",
          "mcp.tool.failed",
          params.name,
          {
            tool_name: params.name,
            error_type: classification.type,
            error_code: classification.code,
            error_message: classification.message,
            // client params intentionally omitted or sanitized
          },
        );
      } catch {
        // Swallow logging errors to avoid cascading failures
      }

      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: classification.code,
          message: classification.message,
          data: classification.data,
        },
      };
    }
  }

  public classifyError(
    error: ErrorPayload,
  ): { type: string; code: number; message: string; data?: Record<string, JSONValue> } {
    const isZodError = (value: ZodErrorCandidate): value is { errors?: Array<object> } => {
      return (
        !!value &&
        typeof value === "object" &&
        "constructor" in value &&
        typeof (value as HasConstructor).constructor === "function" &&
        (value as HasConstructor).constructor.name === "ZodError"
      );
    };

    const getErrorMessage = (value: ErrorPayload): string => {
      if (value instanceof Error) return value.message || "";
      if (typeof value === "string") return value;
      return "";
    };

    // Zod validation errors
    if (isZodError(error)) {
      const zodError = error as { errors: Array<{ path?: (string | number)[]; message: string }> };
      return {
        type: "validation_error",
        code: JsonRpcErrorCode.INVALID_PARAMS,
        message: "Invalid tool arguments",
        data: {
          validation_errors: zodError.errors.map((e) => ({ path: e.path?.join?.(".") ?? "", message: e.message })),
        },
      };
    }

    // If it's an Error instance, inspect the message for classification
    if (error instanceof Error) {
      const msg = getErrorMessage(error);
      const rules: Array<{ type: string; code: number; message: string; needles: string[] }> = [
        {
          type: "security_error",
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: "Access denied: Invalid path",
          needles: ["Path traversal", "outside allowed roots"],
        },
        {
          type: "not_found_error",
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: "Resource not found",
          needles: ["not found", "ENOENT", "Portal"],
        },
        {
          type: "permission_error",
          code: JsonRpcErrorCode.INTERNAL_ERROR,
          message: "Permission denied",
          needles: ["permission", "EACCES", "Permission denied"],
        },
        {
          type: "timeout_error",
          code: JsonRpcErrorCode.INTERNAL_ERROR,
          message: "Operation timed out",
          needles: ["timeout", "aborted", "timed out"],
        },
      ];

      const rule = rules.find((r) => r.needles.some((needle) => msg.includes(needle)));
      if (rule) return { type: rule.type, code: rule.code, message: rule.message };
    }

    // Fallback
    return {
      type: "internal_error",
      code: JsonRpcErrorCode.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : "Internal server error",
    };
  }

  /** Build a standard JSONRPC success response. */
  private successResponse(request: JSONRPCRequest, result: JsonRpcResult): JSONRPCResponse {
    return { jsonrpc: "2.0", id: request.id, result: result as JSONRPCResponse["result"] };
  }

  /** Build a standard JSONRPC internal-error response from a caught exception. */
  private errorResponse(request: JSONRPCRequest, error: ErrorPayload): JSONRPCResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: JsonRpcErrorCode.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * Handles resources/list request
   * Returns all portal resources as URIs
   */
  private async handleResourcesList(
    request: JSONRPCRequest,
  ): Promise<JSONRPCResponse> {
    try {
      // Discover resources from all portals
      const resources = await discoverAllResources(this.config, this.db, {
        maxDepth: 3,
        includeHidden: false,
        extensions: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "md", "json", "toml"],
      });

      return this.successResponse(request, { resources });
    } catch (error) {
      return this.errorResponse(request, error as ErrorPayload);
    }
  }

  /**
   * Handles resources/read request
   * Reads a resource by portal:// URI
   */
  private async handleResourcesRead(
    request: JSONRPCRequest,
  ): Promise<JSONRPCResponse> {
    const params = request.params as { uri: string };

    try {
      // Parse portal:// URI
      const parsed = parsePortalURI(params.uri);
      if (!parsed) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: JsonRpcErrorCode.INVALID_PARAMS,
            message: `Invalid portal URI: ${params.uri}`,
          },
        };
      }

      // Use read_file tool to fetch content
      const readTool = this.tools.get("read_file");
      if (!readTool) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: JsonRpcErrorCode.INTERNAL_ERROR,
            message: "read_file tool not available",
          },
        };
      }

      const result = await readTool.execute({
        portal: parsed.portal,
        path: parsed.path,
      });

      // Log resource read
      this.db.logActivity(
        "mcp.resources",
        "mcp.resources.read",
        params.uri,
        {
          portal: parsed.portal,
          path: parsed.path,
        },
      );

      return this.successResponse(request, { contents: result.content });
    } catch (error) {
      return this.errorResponse(request, error as ErrorPayload);
    }
  }

  /**
   * Handles prompts/list request
   * Returns all available prompt templates
   */
  private handlePromptsList(
    request: JSONRPCRequest,
  ): JSONRPCResponse {
    const prompts = getPrompts();

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        prompts,
      },
    };
  }

  /**
   * Handles prompts/get request
   * Generates a specific prompt with provided arguments
   */
  private handlePromptsGet(
    request: JSONRPCRequest,
  ): JSONRPCResponse {
    const params = request.params as {
      name: string;
      arguments: PromptArguments;
    };

    try {
      const result = generatePrompt(
        params.name,
        params.arguments,
        this.config,
        this.db,
      );

      if (!result) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: JsonRpcErrorCode.INVALID_PARAMS,
            message: `Prompt '${params.name}' not found`,
          },
        };
      }

      return this.successResponse(request, result);
    } catch (error) {
      return this.errorResponse(request, error as ErrorPayload);
    }
  }

  /**
   * Returns comprehensive security headers for HTTP responses
   * Implements Content Security Policy and other security measures
   */
  public getSecurityHeaders(): Record<string, string> {
    return {
      // Prevent XSS attacks with Content Security Policy
      "Content-Security-Policy": "default-src 'none'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none';",

      // Prevent clickjacking attacks
      "X-Frame-Options": "DENY",

      // Prevent MIME sniffing attacks
      "X-Content-Type-Options": "nosniff",

      // Enable XSS filtering in browsers
      "X-XSS-Protection": "1; mode=block",

      // Enforce HTTPS with HTTP Strict Transport Security
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

      // Control referrer information
      "Referrer-Policy": "strict-origin-when-cross-origin",

      // Restrict browser permissions/features
      "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    };
  }

  /**
   * Adds security headers to an HTTP Response object
   * Used for HTTP/SSE transport responses
   */
  public addSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);

    // Add all security headers
    const securityHeaders = this.getSecurityHeaders();
    for (const [key, value] of Object.entries(securityHeaders)) {
      headers.set(key, value);
    }

    // Return new response with security headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /**
   * Handles HTTP requests for MCP over HTTP transport
   * Applies security headers to all responses
   */
  async handleHTTPRequest(request: Request): Promise<MCPHttpResponse> {
    try {
      // Delegate to SSE handler for SSE routes
      if (this.sseHandler) {
        const url = new URL(request.url);
        if (SseHandler.matchesTraceIdRoute(url.pathname)) {
          return this.addSecurityHeaders(this.sseHandler.handleRequest(request));
        }
      }

      // Only allow POST requests for JSON-RPC
      if (request.method !== "POST") {
        const response = new Response("Method not allowed", { status: 405 });
        return this.addSecurityHeaders(response);
      }

      // Parse JSON-RPC request
      const jsonRpcRequest: JSONRPCRequest = await request.json();

      // Process the request
      const result = await this.handleRequest(jsonRpcRequest);

      // Return JSON response with security headers
      const response = new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      return this.addSecurityHeaders(response);
    } catch (_error) {
      // Return error response with security headers
      const errorResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: JsonRpcErrorCode.PARSE_ERROR,
          message: "Parse error",
        },
      };

      const response = new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });

      return this.addSecurityHeaders(response);
    }
  }

  /**
   * Starts HTTP server for MCP over HTTP/SSE transport
   * Only available when transport is configured as "sse"
   */
  async startHTTPServer(port: number = 3000): Promise<void> {
    if (this.transport !== "sse") {
      throw new Error("HTTP server only available for SSE transport");
    }

    if (this.running) {
      throw new Error("MCP Server is already running");
    }

    this.running = true;

    // Log server start
    this.db.logActivity(
      "mcp.server",
      "mcp.http_server.started",
      null,
      {
        transport: this.transport,
        port,
        server_name: this.serverName,
        server_version: this.serverVersion,
      },
    );

    logInfo("MCP HTTP Server starting", {
      audit_event: true,
      event_type: "server_startup",
      server_type: "mcp-http",
      port,
      protocol: "http",
      service: "mcp-server",
    });

    await Deno.serve({ port, hostname: "localhost" }, (request: Request) => this.handleHTTPRequest(request));
  }
}
