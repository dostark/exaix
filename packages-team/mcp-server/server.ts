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
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { MCPConfigSchema, type MCPTool } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_MCP_AUTH_TOKEN_EXPIRY_SECONDS, JsonRpcErrorCode, MCP_CONTENT_TYPE_STRUCTURED_DATA } from "@exaix/core";
import { appendToolChoiceHint, McpTransportType } from "@exaix/mcp";
import type { ToolHandler } from "@exaix/mcp/server";
import { EventBusService } from "@exaix/core/observability";
import { MCP_OAUTH_RESPONSE_TYPE_NONE } from "./constants.ts";
import { SseHandler } from "./sse_handler.ts";
import { buildHandlers } from "./tools.ts";
import { discoverAllResources, parsePortalURI } from "./resources.ts";
import { generatePrompt, getPrompts } from "./prompts.ts";
import {
  type AuthInfo,
  type AuthMetadataOptions,
  type CallToolResult,
  createMcpHandler,
  fromJsonSchema,
  type GetPromptResult,
  hostHeaderValidationResponse,
  type JsonSchemaType,
  type jsonSchemaValidator as IJsonSchemaValidatorProvider,
  type JsonSchemaValidatorResult,
  type ListResourcesResult,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpHttpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  type OAuthTokenVerifier,
  originValidationResponse,
  type ReadResourceResult,
  requireBearerAuth,
  ResourceTemplate,
} from "@modelcontextprotocol/server";

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
/** Web-standard fetch response for the MCP-over-HTTP handler. */
type McpHttpFetchResponse = Response;
type McpHttpFetchResponsePromise = Promise<McpHttpFetchResponse>;

/** Uniform outcome of executing one tool, decoupled from either transport's own
 *  top-level-vs-in-band error convention. */
interface IToolExecutionOutcome {
  result?: JsonRpcResult;
  error?: { code: number; message: string; data?: JsonRpcErrorData };
}

/** No-op JSON-Schema validator for `fromJsonSchema` tool/prompt registrations: SDK
 *  pre-validation is bypassed so argument validation stays 100% delegated to each
 *  handler's own Zod `.parse()`; only the advertised list schema comes from here. */
const PASSTHROUGH_JSON_SCHEMA_VALIDATOR: IJsonSchemaValidatorProvider = {
  getValidator<T>(_schema: JsonSchemaType) {
    return (input): JsonSchemaValidatorResult<T> =>
      ({ valid: true, data: input, errorMessage: undefined }) as JsonSchemaValidatorResult<T>;
  },
};

/** Constant-time string equality for the MCP shared-secret Bearer token — Deno has no
 *  `crypto.timingSafeEqual` for strings, so this is the XOR-accumulation equivalent
 *  (the early `length` check leaks only length, not secret). Never use `===` on the token. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Adapts a `ToolHandler.execute()` result onto the SDK's `CallToolResult`. The spec has
 *  no ContentBlock member for Exaix's `exaix_structured_data` type (SDK rejects it), so
 *  this moves each such block's `data` onto `structuredContent` instead — lossless. */
export function toSdkCallToolResult(result: Opt<JsonRpcResult, Reason.OptionalInput>): CallToolResult {
  const raw = result as { content?: Array<{ type: string; data?: JSONValue }>; isError?: boolean } | undefined;
  const content: Array<{ type: string; data?: JSONValue }> = [];
  let structuredContent: Record<string, JSONValue> | undefined;
  for (const item of raw?.content ?? []) {
    if (item.type === MCP_CONTENT_TYPE_STRUCTURED_DATA) {
      const value = item.data;
      structuredContent = (value !== null && typeof value === "object" && !Array.isArray(value))
        ? value as Record<string, JSONValue>
        : { data: value ?? null };
      continue;
    }
    content.push(item);
  }
  return {
    content,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(raw?.isError ? { isError: true } : {}),
  } as CallToolResult;
}

/** MCP server: stdio and HTTP transports, tool/resource/prompt registration, auth, and
 *  Activity Journal logging. See @related-files above for tools/resources/prompts. */
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

export class MCPServer implements OAuthTokenVerifier {
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
  /** Retained so `stop()` can actually close the HTTP listener. */
  private httpServerHandle?: Deno.HttpServer;
  /** Retained so `stop()` can tear down the SDK's modern-leg in-flight state alongside the listener. */
  private mcpHttpHandler?: McpHttpHandler;

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

    // Actually tear down the HTTP listener (fire-and-forget is acceptable here — stop()
    // is synchronous by contract; both teardowns are idempotent and safe unawaited).
    if (this.httpServerHandle) {
      void this.httpServerHandle.shutdown();
      this.httpServerHandle = undefined;
    }
    if (this.mcpHttpHandler) {
      void this.mcpHttpHandler.close();
      this.mcpHttpHandler = undefined;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getTransport(): string {
    return this.transport;
  }

  getServerName(): string {
    return this.serverName;
  }

  getVersion(): string {
    return this.serverVersion;
  }

  /** Handles an incoming JSON-RPC 2.0 request, returning a response with result or error. */
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

  /** Handles tools/list request; returns all registered tools with their definitions. */
  private handleToolsList(
    request: JSONRPCRequest,
  ): JSONRPCResponse {
    const toolDefinitions = Array.from(this.tools.values()).map((tool) => {
      const definition = tool.getToolDefinition();
      return { ...definition, description: appendToolChoiceHint(definition.name, definition.description) };
    });

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

  /** Handles tools/call request; executes the specified tool with provided arguments. */
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

    const outcome = await this.executeToolInternal(params.name, tool, params.arguments);
    if (outcome.error) {
      return { jsonrpc: "2.0", id: request.id, error: outcome.error };
    }
    return { jsonrpc: "2.0", id: request.id, result: outcome.result };
  }

  /** Executes one already-resolved tool through the shared validation/remediation/logging pipeline. Returns a
   *  transport-neutral outcome: `handleToolsCall` wraps `error` as a top-level JSON-RPC error, while the SDK's
   *  `registerTool` callback wraps it in-band as `isError:true` content — the SDK never emits a top-level error. */
  private async executeToolInternal(
    toolName: string,
    tool: ToolHandler,
    args: JsonRpcArguments,
  ): Promise<IToolExecutionOutcome> {
    try {
      // Execute tool
      let result = await tool.execute(args as Record<string, JSONValue>);

      // Validate MCP response envelope when a validator is injected (Enforcement Point 3).
      // rawResult is captured in the failure for audit logging only — never forwarded to clients.
      if (this.resultValidator) {
        const validationFailure = this.resultValidator.validateMCPResponse(toolName, result);
        if (validationFailure) {
          const remediationPolicy = this.resolveRemediationPolicy(toolName);
          const remediationMetadata = lookupRemediationToolMetadata(toolName) ?? undefined;

          if (remediationPolicy) {
            const remediationResult = await applyRemediationPolicy(
              toolName,
              remediationPolicy,
              validationFailure,
              this.resultValidator,
              {
                normalize: (rawResponse) => rawResponse,
                retry: async () => {
                  const retryResult = await tool.execute(args as Record<string, JSONValue>);
                  return retryResult as JSONValue;
                },
                toolMetadata: remediationMetadata,
              },
            );

            await this.reportValidationOutcome(toolName, remediationPolicy, remediationResult);

            if (remediationResult.outcome === "passed") {
              result = remediationResult.remediatedResult as typeof result;
            } else {
              return {
                result: {
                  content: [
                    {
                      type: "text",
                      text: `Tool result validation failed for '${toolName}': ${
                        (remediationResult.failure ?? validationFailure).issues.map((i) => i.message).join("; ")
                      }`,
                    },
                  ],
                  isError: true,
                },
              };
            }
          } else {
            await this.reportValidationOutcome(toolName, this.getFallbackValidationPolicy(toolName), {
              outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
              failure: validationFailure,
              retriesAttempted: 0,
            });
            return {
              result: {
                content: [
                  {
                    type: "text",
                    text: `Tool result validation failed for '${toolName}': ${
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
          toolName,
          {
            tool_name: toolName,
            success: true,
            has_result: !!result,
          },
        );
      } catch {
        // Logging must not break tool execution
      }

      return { result };
    } catch (error) {
      // Classify and sanitize errors for JSON-RPC
      const classification = this.classifyError(error as ErrorPayload);

      if (classification.type === "permission_error") {
        try {
          this.logActivity(
            "mcp.server",
            DomainEventType.McpPermissionDenied,
            toolName,
            {
              tool_name: toolName,
              portal: typeof args.portal === "string" ? args.portal : null,
              agent_role: typeof args.agent_role === "string" ? args.agent_role : null,
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
          toolName,
          {
            tool_name: toolName,
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
    const isZodError = (value: ZodErrorCandidate): value is { errors?: Array<object>; issues?: Array<object> } => {
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

    // Zod validation errors (zod v4 exposes `issues`; older shapes expose `errors`)
    if (isZodError(error)) {
      const zodError = error as {
        errors?: Array<{ path?: (string | number)[]; message: string }>;
        issues?: Array<{ path?: (string | number)[]; message: string }>;
      };
      const issues = zodError.issues ?? zodError.errors ?? [];
      return {
        type: "validation_error",
        code: JsonRpcErrorCode.INVALID_PARAMS,
        message: "Invalid tool arguments",
        data: {
          validation_errors: issues.map((e) => ({ path: e.path?.join?.(".") ?? "", message: e.message })),
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

  /** Handles resources/list request; returns all portal resources as URIs. */
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

  /** Handles resources/read request; reads a resource by portal:// URI. */
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

  /** Handles prompts/list request; returns all available prompt templates. */
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

  /** Handles prompts/get request; generates a specific prompt with provided arguments. */
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

  /** Handles exaix/tools/result_schema — returns the expected result schema descriptor for
   *  a named tool, derived from TOOL_MANIFEST and TOOL_RESULT_SCHEMA_REGISTRY. */
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

  /** Builds an official-SDK `McpServer` from this server's already-constructed tools/config/permissions/logger, for
   *  stdio serving via `serveStdio`. Reuses the existing tool schemas and executeToolInternal/generatePrompt/etc.
   *  verbatim — only the protocol envelope (JSON-RPC dispatch vs SDK registration) changes. */
  buildSdkServer(): McpServer {
    const sdkServer = new McpServer({ name: this.serverName, version: this.serverVersion });

    for (const tool of this.tools.values()) {
      const definition = tool.getToolDefinition();
      sdkServer.registerTool(
        definition.name,
        {
          description: appendToolChoiceHint(definition.name, definition.description),
          inputSchema: fromJsonSchema(definition.inputSchema, PASSTHROUGH_JSON_SCHEMA_VALIDATOR),
        },
        async (args): Promise<CallToolResult> => {
          const outcome = await this.executeToolInternal(definition.name, tool, args as JsonRpcArguments);
          if (outcome.error) {
            return { content: [{ type: "text", text: outcome.error.message }], isError: true };
          }
          return toSdkCallToolResult(outcome.result);
        },
      );
    }

    for (const prompt of getPrompts()) {
      const promptArgs = prompt.arguments ?? [];
      const argsJsonSchema = {
        type: "object" as const,
        properties: Object.fromEntries(
          promptArgs.map((arg) => [arg.name, { type: "string", description: arg.description }]),
        ),
        required: promptArgs.filter((arg) => arg.required).map((arg) => arg.name),
      };
      sdkServer.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema: fromJsonSchema(argsJsonSchema, PASSTHROUGH_JSON_SCHEMA_VALIDATOR),
        },
        (args): GetPromptResult => {
          const result = generatePrompt(prompt.name, args as PromptArguments, this.config, this.logger);
          if (!result) {
            throw new Error(`Prompt '${prompt.name}' not found`);
          }
          // IMCPPromptResult's role field is nominally wider than the SDK's user-or-assistant
          // restriction, but `generatePrompt` only ever emits MessageRole.USER — safe cast.
          return result as GetPromptResult;
        },
      );
    }

    const resourceDiscoveryOptions = {
      maxDepth: 3,
      includeHidden: false,
      extensions: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "md", "json", "toml"],
    };
    sdkServer.registerResource(
      "portal-files",
      new ResourceTemplate("portal://{portal}/{+path}", {
        list: async (): Promise<ListResourcesResult> => ({
          resources: await discoverAllResources(this.config, this.logger, resourceDiscoveryOptions),
        }),
      }),
      { description: "Files across all configured portals" },
      async (uri): Promise<ReadResourceResult> => {
        const parsed = parsePortalURI(uri.toString());
        if (!parsed) {
          throw new Error(`Invalid portal URI: ${uri.toString()}`);
        }
        const readTool = this.tools.get("read_file");
        if (!readTool) {
          throw new Error("read_file tool not available");
        }
        const result = await readTool.execute({ portal: parsed.portal, path: parsed.path });
        this.logActivity(
          "mcp.resources",
          DomainEventType.McpResourcesRead,
          uri.toString(),
          { portal: parsed.portal, path: parsed.path },
        );
        const firstContent = result.content[0] as { text?: string } | undefined;
        return { contents: [{ uri: uri.toString(), mimeType: "text/plain", text: firstContent?.text ?? "" }] };
      },
    );

    sdkServer.server.setRequestHandler(
      "exaix/tools/result_schema",
      { params: ToolResultSchemaRequestSchema },
      (params: { tool: string }) => {
        const descriptor = buildToolResultSchemaDescriptor(params.tool);
        if (!descriptor) {
          throw new Error(`No result schema registered for tool '${params.tool}'`);
        }
        return descriptor;
      },
    );

    return sdkServer;
  }

  /** Returns comprehensive security headers for HTTP responses (CSP and other measures). */
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

  /** Adds security headers to an HTTP Response object (HTTP/SSE transport responses). */
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

  /** Verifies a Bearer token against the static shared secret named by `mcp.auth_token_env`, compared via
   *  `constantTimeEqual` (never `===`) — deliberately minimal for this tool's threat model (single-operator,
   *  localhost-primary). `expiresAt` is always set to a far-future epoch (a static secret never expires); a mismatch throws `OAuthError` → 401. */
  verifyAccessToken(token: string): Promise<AuthInfo> {
    const mcpConfig = MCPConfigSchema.parse(this.config.mcp);
    const configured = Deno.env.get(mcpConfig.auth_token_env) ?? "";
    if (!constantTimeEqual(configured, token)) {
      return Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, "Invalid bearer token"));
    }
    return Promise.resolve({
      token,
      clientId: "exaix-mcp-client",
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) +
        (mcpConfig.auth_token_expiry_seconds ?? DEFAULT_MCP_AUTH_TOKEN_EXPIRY_SECONDS),
    });
  }

  /** RFC 9728 protected-resource metadata for the current request. The issuer/resource-server URL derives from the
   *  request's own origin — the server binds `localhost` only, so it always satisfies the SDK's HTTPS-or-loopback
   *  rule. The AS endpoints point at the server's own origin, since for a static shared-secret deployment the server itself is the token authority (only the resource-server half of RFC 9728 is served). */
  private buildAuthMetadataOptions(request: Request): AuthMetadataOptions {
    const origin = new URL(request.url).origin;
    return {
      oauthMetadata: {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        response_types_supported: [MCP_OAUTH_RESPONSE_TYPE_NONE],
        scopes_supported: [],
      },
      resourceServerUrl: new URL(origin),
      resourceName: this.serverName,
      scopesSupported: [],
    };
  }

  /** Composed fetch handler for MCP-over-HTTP: Host/Origin validation → `sse_handler.ts` trace route → SDK MCP
   *  JSON-RPC dispatch → Exaix's security headers. Real Streamable HTTP always frames a response as a single-event
   *  SSE stream, never bare JSON — spec behavior. `mcp.require_auth` gates dispatch behind `requireBearerAuth` and serves RFC 9728/8414 metadata when enabled; disabled (default) is byte-identical to no auth. */
  public buildHttpFetch(): (request: Request) => McpHttpFetchResponsePromise {
    const mcpConfig = MCPConfigSchema.parse(this.config.mcp);
    const requireAuth = mcpConfig.require_auth;

    let authGate: ((request: Request) => Promise<AuthInfo | Response>) | undefined;
    if (requireAuth) {
      const tokenEnv = mcpConfig.auth_token_env;
      if ((Deno.env.get(tokenEnv) ?? "") === "") {
        throw new Error(
          `mcp.require_auth is enabled but no bearer token is configured — set env var "${tokenEnv}" (config key auth_token_env)`,
        );
      }
      authGate = requireBearerAuth({ verifier: this });
    }

    const handler = createMcpHandler(() => this.buildSdkServer(), { legacy: "stateless" });
    this.mcpHttpHandler = handler;
    const sseHandler = this.sseHandler ?? new SseHandler(EventBusService.getInstance());

    return async (request: Request): McpHttpFetchResponsePromise => {
      const rejected = hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins());
      if (rejected) {
        return this.addSecurityHeaders(rejected);
      }

      const url = new URL(request.url);
      const isTraceRoute = SseHandler.matchesTraceIdRoute(url.pathname);

      if (authGate) {
        const metadata = oauthMetadataResponse(request, this.buildAuthMetadataOptions(request));
        if (metadata) {
          return this.addSecurityHeaders(metadata);
        }
        // The trace-stream SSE route must be gated by the same bearer auth as every other
        // MCP HTTP route, or it stays reachable without a token when mcp.require_auth=true.
        const auth = await authGate(request);
        if (auth instanceof Response) {
          return this.addSecurityHeaders(auth);
        }
        if (isTraceRoute) {
          return this.addSecurityHeaders(sseHandler.handleRequest(request));
        }
        const response = await handler.fetch(request, { authInfo: auth });
        return this.addSecurityHeaders(response);
      }

      if (isTraceRoute) {
        return this.addSecurityHeaders(sseHandler.handleRequest(request));
      }

      const response = await handler.fetch(request);
      return this.addSecurityHeaders(response);
    };
  }

  /** Starts HTTP server for MCP over HTTP/SSE transport (only when transport is "sse").
   *  Returns the actual bound port (useful when `port` is `0`, e.g. in tests). */
  startHTTPServer(port: number = 3000): number {
    if (this.transport !== "sse") {
      throw new Error("HTTP server only available for SSE transport");
    }

    if (this.running) {
      throw new Error("MCP Server is already running");
    }

    this.running = true;

    // Deno.serve() returns its handle synchronously (not a Promise) — retained on the
    // instance so stop() can actually close the listener.
    this.httpServerHandle = Deno.serve({ port, hostname: "localhost" }, this.buildHttpFetch());
    const addr = this.httpServerHandle.addr;
    const boundPort = addr.transport === "tcp" || addr.transport === "udp" ? addr.port : port;

    // Log server start with the actual bound port (matches `port` unless it was 0).
    this.logActivity(
      "mcp.server",
      DomainEventType.McpHttpServerStarted,
      null,
      {
        transport: this.transport,
        port: boundPort,
        server_name: this.serverName,
        server_version: this.serverVersion,
      },
    );

    return boundPort;
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

/** Builds the official-SDK `McpServer` factory `serveStdio(buildMcpServer)` consumes
 *  (`apps/mcp-server/main.ts`): constructs the same `MCPServer` this file always built
 *  and adapts it onto the SDK via `buildSdkServer()`. */
export function buildMcpServer(options: ConstructorParameters<typeof MCPServer>[0]): McpServer {
  const mcpServer = new MCPServer(options);
  return mcpServer.buildSdkServer();
}
