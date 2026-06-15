/**
 * @module McpServer
 * @path packages-team/mcp-server/server.ts
 * @description core MCP server implementation, handling JSON-RPC transport, tool registration, and security orchestration.
 * @architectural-layer MCP
 * @related-files [packages-team/mcp-server/tools.ts, packages-team/mcp-server/resources.ts, packages-team/mcp-server/prompts.ts]
 */
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { ICliApplicationContext } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { MCPConfigSchema, type MCPTool } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core";
import { JsonRpcErrorCode } from "@exaix/core";
import { McpTransportType } from "@exaix/mcp";
import type { ToolHandler } from "@exaix/mcp/server";
import { EventBusService } from "@exaix/core/observability";
import { SseHandler } from "./sse_handler.ts";
import { buildHandlers } from "./tools.ts";
import { discoverAllResources, parsePortalURI } from "./resources.ts";
import { generatePrompt, getPrompts } from "./prompts.ts";

import { PortalPermissionsService } from "@exaix/portal";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import { buildToolResultSchemaDescriptor, lookupRemediationPolicy, lookupRemediationToolMetadata } from "@exaix/mcp";
import { type IToolResultRemediationPolicy, ToolResultSchemaRequestSchema } from "@exaix/schemas/tool_result.ts";
import {
  applyRemediationPolicy,
  type IRemediationResult,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
} from "@exaix/schemas/tool_result_remediation.ts";
import { type IValidationReportContext, logValidationResult } from "@exaix/tool-runtime";

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
  logger?: IEventLogger;
  permissions?: IPortalPermissionsChecker;
  resultValidator?: IToolResultValidator;
  validationReportContext?: IValidationReportContext;
  remediationPolicyResolver?: (
    toolName: string,
    policy: IToolResultRemediationPolicy,
  ) => IToolResultRemediationPolicy;
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
  private logger?: IEventLogger;
  private transport: McpTransportType;
  private running = false;
  private serverName: string;
  private serverVersion: string;
  private tools: Map<string, ToolHandler> = new Map();
  private sseHandler?: SseHandler;
  private permissions: IPortalPermissionsChecker;
  private resultValidator?: IToolResultValidator;
  private validationReportContext?: IValidationReportContext;
  private remediationPolicyResolver?: (
    toolName: string,
    policy: IToolResultRemediationPolicy,
  ) => IToolResultRemediationPolicy;

  constructor(options: MCPServerOptions) {
    this.context = options.context;
    this.config = options.context.config.getAll();
    this.logger = options.logger;
    this.transport = options.transport;
    this.resultValidator = options.resultValidator;
    this.validationReportContext = options.validationReportContext;
    this.remediationPolicyResolver = options.remediationPolicyResolver;

    // Auto-create EventBusService for SSE transport and wire SSE handler
    if (this.transport === McpTransportType.SSE) {
      const eventBus = EventBusService.getInstance();
      this.sseHandler = new SseHandler(eventBus);
    }

    // Validate MCP config
    const mcpConfig = MCPConfigSchema.parse(this.config.mcp);
    this.serverName = mcpConfig.server_name;
    this.serverVersion = mcpConfig.version;
    this.permissions = options.permissions ?? new PortalPermissionsService(this.config.portals);

    for (const handler of buildHandlers(this.context, this.permissions, this.logger).values()) {
      this.registerTool(handler);
    }
  }

  /**
   * Log activity via IEventLogger (preferred) or fall back to db.logActivity
   */
  private logActivity(
    _actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
  ): void {
    if (!this.logger) return;
    void this.logger.info(actionType, target, payload);
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
    this.logActivity(
      "mcp.server",
      DomainEventType.McpServerStarted,
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
    this.logActivity(
      "mcp.server",
      DomainEventType.McpServerStopped,
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
      case "exaix/tools/result_schema":
        return this.handleToolResultSchema(request);
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
    this.logActivity(
      "mcp.server",
      DomainEventType.McpInitialize,
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
    this.logActivity(
      "mcp.server",
      DomainEventType.McpToolsList,
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
      this.logActivity(
        "mcp.server",
        DomainEventType.McpToolNotFound,
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
      let result = await tool.execute(params.arguments as Record<string, JSONValue>);

      // Validate MCP response envelope when a validator is injected (Enforcement Point 3).
      // rawResult is captured in the failure for audit logging only — never forwarded to clients.
      if (this.resultValidator) {
        const validationFailure = this.resultValidator.validateMCPResponse(params.name, result);
        if (validationFailure) {
          const remediationPolicy = this.resolveRemediationPolicy(params.name);
          const remediationMetadata = lookupRemediationToolMetadata(params.name) ?? undefined;

          if (remediationPolicy) {
            const remediationResult = await applyRemediationPolicy(
              params.name,
              remediationPolicy,
              validationFailure,
              this.resultValidator,
              {
                normalize: (rawResponse) => rawResponse,
                retry: async () => {
                  const retryResult = await tool.execute(params.arguments as Record<string, JSONValue>);
                  return retryResult as JSONValue;
                },
                toolMetadata: remediationMetadata,
              },
            );

            await this.reportValidationOutcome(params.name, remediationPolicy, remediationResult);

            if (remediationResult.outcome === "passed") {
              result = remediationResult.remediatedResult as typeof result;
            } else {
              return {
                jsonrpc: "2.0",
                id: request.id,
                result: {
                  content: [
                    {
                      type: "text",
                      text: `Tool result validation failed for '${params.name}': ${
                        (remediationResult.failure ?? validationFailure).issues.map((i) => i.message).join("; ")
                      }`,
                    },
                  ],
                  isError: true,
                },
              };
            }
          } else {
            await this.reportValidationOutcome(params.name, this.getFallbackValidationPolicy(params.name), {
              outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
              failure: validationFailure,
              retriesAttempted: 0,
            });
            return {
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: `Tool result validation failed for '${params.name}': ${
                      validationFailure.issues.map((i) => i.message).join("; ")
                    }`,
                  },
                ],
                isError: true,
              },
            };
          }
        }
      }

      // Log successful tool execution (sanitized)
      try {
        this.logActivity(
          "mcp.server",
          DomainEventType.McpToolExecuted,
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

      if (classification.type === "permission_error") {
        try {
          this.logActivity(
            "mcp.server",
            DomainEventType.McpPermissionDenied,
            params.name,
            {
              tool_name: params.name,
              portal: typeof params.arguments.portal === "string" ? params.arguments.portal : null,
              identity_id: typeof params.arguments.identity_id === "string" ? params.arguments.identity_id : null,
              error_message: classification.message,
            },
          );
        } catch {
          // Swallow logging errors to avoid cascading failures
        }
      }

      // Log error with context (do not include sensitive details)
      try {
        this.logActivity(
          "mcp.server",
          DomainEventType.McpToolFailed,
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

  private resolveRemediationPolicy(toolName: string): IToolResultRemediationPolicy | null {
    const policy = lookupRemediationPolicy(toolName);
    if (!policy) {
      return null;
    }
    return this.remediationPolicyResolver ? this.remediationPolicyResolver(toolName, policy) : policy;
  }

  private getFallbackValidationPolicy(toolName: string): IToolResultRemediationPolicy {
    return {
      tool: toolName,
      mode: "fail_closed",
      maxRetries: 0,
      requiresIdempotency: false,
      allowRetryAfterSideEffect: false,
      logValidationFailures: true,
      triggerPlanAmendmentOnFailure: false,
    };
  }

  private async reportValidationOutcome(
    toolName: string,
    policy: IToolResultRemediationPolicy,
    result: IRemediationResult,
  ): Promise<void> {
    try {
      await logValidationResult(
        toolName,
        policy,
        result,
        this.logger ?? createNoopLogger(),
        this.validationReportContext,
      );
    } catch {
      // Validation reporting must not break MCP tool execution.
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
      const lowerMsg = msg.toLowerCase();
      const rules: Array<{ type: string; code: number; message: string; needles: string[] }> = [
        {
          type: "security_error",
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: "Access denied: Invalid path",
          needles: ["path traversal", "outside allowed roots"],
        },
        {
          type: "not_found_error",
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: "Resource not found",
          needles: ["not found", "enoent"],
        },
        {
          type: "permission_error",
          code: JsonRpcErrorCode.INTERNAL_ERROR,
          message: "Permission denied",
          needles: ["permission", "eacces", "permission denied", "not permitted", "not allowed"],
        },
        {
          type: "timeout_error",
          code: JsonRpcErrorCode.INTERNAL_ERROR,
          message: "Operation timed out",
          needles: ["timeout", "aborted", "timed out"],
        },
      ];

      const rule = rules.find((r) => r.needles.some((needle) => lowerMsg.includes(needle)));
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
      const resources = await discoverAllResources(this.config, this.logger, {
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
      this.logActivity(
        "mcp.resources",
        DomainEventType.McpResourcesRead,
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
        this.logger,
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
   * Handles exaix/tools/result_schema — returns the expected result schema descriptor
   * for a named tool, derived from TOOL_MANIFEST and TOOL_RESULT_SCHEMA_REGISTRY.
   */
  private handleToolResultSchema(request: JSONRPCRequest): JSONRPCResponse {
    const parsed = ToolResultSchemaRequestSchema.safeParse(request.params);
    if (!parsed.success) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: `Invalid params for exaix/tools/result_schema: ${parsed.error.message}`,
        },
      };
    }
    const descriptor = buildToolResultSchemaDescriptor(parsed.data.tool);
    if (!descriptor) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: JsonRpcErrorCode.INVALID_PARAMS,
          message: `No result schema registered for tool '${parsed.data.tool}'`,
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: descriptor as JsonRpcResult,
    };
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
   * Returns true if the request's Host resolves to the local loopback. The HTTP
   * server binds to localhost, but a DNS-rebinding page can still reach it from a
   * victim's browser with an attacker Host header — so we validate it (Finding 5).
   */
  private static isLoopbackHost(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  }

  /**
   * Rejects requests that are not safe to serve on a localhost-only tool endpoint:
   * a non-loopback Host (DNS rebinding) or a cross-origin browser request (CSRF).
   * Local CLI/MCP clients send a loopback Host and no Origin, so they are unaffected.
   */
  private rejectUnsafeOrigin(request: Request): MCPHttpResponse | null {
    const hostname = new URL(request.url).hostname;
    if (!MCPServer.isLoopbackHost(hostname)) {
      return this.addSecurityHeaders(new Response("Forbidden: host not allowed", { status: 403 }));
    }

    const origin = request.headers.get("Origin");
    if (origin !== null) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        originHost = null;
      }
      if (originHost === null || !MCPServer.isLoopbackHost(originHost)) {
        return this.addSecurityHeaders(new Response("Forbidden: cross-origin request", { status: 403 }));
      }
    }
    return null;
  }

  /**
   * Handles HTTP requests for MCP over HTTP transport
   * Applies security headers to all responses
   */
  async handleHTTPRequest(request: Request): Promise<MCPHttpResponse> {
    try {
      // Reject DNS-rebinding (non-loopback Host) and cross-origin (CSRF) requests
      // before any routing or body parsing.
      const rejection = this.rejectUnsafeOrigin(request);
      if (rejection) return rejection;

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
    this.logActivity(
      "mcp.server",
      DomainEventType.McpHttpServerStarted,
      null,
      {
        transport: this.transport,
        port,
        server_name: this.serverName,
        server_version: this.serverVersion,
      },
    );

    // Event already logged via logActivity above

    await Deno.serve({ port, hostname: "localhost" }, (request: Request) => this.handleHTTPRequest(request));
  }
}

function createNoopLogger(): IEventLogger {
  return {
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    log: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => createNoopLogger(),
  };
}
