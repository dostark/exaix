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
/** Web-standard fetch response for the MCP-over-HTTP handler (Step 3). */
type McpHttpFetchResponse = Response;
type McpHttpFetchResponsePromise = Promise<McpHttpFetchResponse>;

/** Uniform outcome of executing one tool, decoupled from either transport's own top-level-vs-in-band error convention (Step 2). */
interface IToolExecutionOutcome {
  result?: JsonRpcResult;
  error?: { code: number; message: string; data?: JsonRpcErrorData };
}

/**
 * No-op JSON-Schema validator provider for `fromJsonSchema` tool/prompt registrations
 * (Step 2). The SDK's own JSON-Schema pre-validation is intentionally bypassed here so
 * `tools/call`/`prompts/get` argument validation stays 100% delegated to each handler's
 * own Zod `.parse()` — exactly matching pre-migration behavior (Constraints: byte-identical,
 * not shape-only). Only `tools/list`/`prompts/list`'s advertised schema comes from
 * `fromJsonSchema`; runtime enforcement is unchanged. See Architecture Notes.
 */
const PASSTHROUGH_JSON_SCHEMA_VALIDATOR: IJsonSchemaValidatorProvider = {
  getValidator<T>(_schema: JsonSchemaType) {
    return (input): JsonSchemaValidatorResult<T> =>
      ({ valid: true, data: input, errorMessage: undefined }) as JsonSchemaValidatorResult<T>;
  },
};

/**
 * Constant-time string equality for the MCP shared-secret Bearer token (Step 4).
 * Deno has no `crypto.timingSafeEqual` for strings, so this is the standard
 * XOR-accumulation equivalent: every byte pair is compared regardless of where
 * the first mismatch occurs (the early `length` check leaks only the length,
 * which is not secret for a configured token). Never use `===` on the token.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Adapts a `ToolHandler.execute()` result onto the official SDK's `CallToolResult` (Step 2).
 * The 2026-07-28 spec's `ContentBlock` union (text/image/audio/resource/resource_link) has
 * no member for Exaix's proprietary `exaix_structured_data` content type — the SDK's
 * `registerTool` validates outgoing tool results against that union server-side and rejects
 * unknown content types with a protocol error (confirmed empirically: passing an
 * `exaix_structured_data` block straight through fails validation before it reaches the
 * wire). The SDK's own dedicated `structuredContent` result field (a free-form key-value
 * object) is the spec's real, dedicated mechanism for exactly this payload (arbitrary
 * structured data
 * alongside human-readable text) — this function moves each `exaix_structured_data` block's
 * `data` there instead of leaving it in `content`. Object-shaped `data` (e.g. domain-tool
 * results) maps directly; array/primitive-shaped `data` (e.g. `list_directory`'s
 * `string[]` entries) is wrapped under a `data` key, since `structuredContent` must itself
 * be an object. Lossless — the same information survives, only the wire envelope changes
 * to satisfy the SDK's real, unavoidable validation; not a tool-surface redesign.
 */
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
  /** Retained so `stop()` can actually close the HTTP listener (Pre-Gap Analysis GAP-9). */
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

    // Pre-Gap Analysis GAP-9: actually tear down the HTTP listener (fire-and-forget is
    // acceptable here — stop() is synchronous by existing contract; both teardowns are
    // idempotent and safe to leave unawaited).
    if (this.httpServerHandle) {
      void this.httpServerHandle.shutdown();
      this.httpServerHandle = undefined;
    }
    if (this.mcpHttpHandler) {
      void this.mcpHttpHandler.close();
      this.mcpHttpHandler = undefined;
    }
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

    const outcome = await this.executeToolInternal(params.name, tool, params.arguments);
    if (outcome.error) {
      return { jsonrpc: "2.0", id: request.id, error: outcome.error };
    }
    return { jsonrpc: "2.0", id: request.id, result: outcome.result };
  }

  /**
   * Executes one already-resolved tool, running the exact pre-migration
   * validation/remediation/logging/classification pipeline (Constraints: byte-identical
   * business logic, not rewritten) — extracted out of `handleToolsCall` (Step 2) so the
   * official SDK's `registerTool` callback (`buildSdkServer`) can reuse it verbatim.
   * Returns a transport-neutral outcome: `handleToolsCall` (HTTP/hand-rolled dispatch,
   * pre-Step-3) wraps `error` as a top-level JSON-RPC error; `buildSdkServer`'s SDK
   * callback wraps it as `isError:true` tool-result content instead, since the official
   * SDK always converts a tool callback's thrown/returned error into in-band content —
   * it never emits a top-level JSON-RPC error for a tool-execution failure (confirmed
   * against the vendored SDK: even a thrown `ProtocolError` inside `registerTool`'s
   * callback is caught and returned as `{content, isError:true}`). This is the one
   * intentional, SDK-intrinsic behavior difference this migration cannot avoid; the
   * diagnostic message/classification is preserved byte-for-byte, only the JSON-RPC
   * envelope (top-level `error` vs in-band `isError`) changes for tool-execution failures.
   */
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
              identity_id: typeof args.identity_id === "string" ? args.identity_id : null,
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
   * Builds an official-SDK `McpServer` instance from this server's already-constructed
   * tools/config/permissions/logger (Step 2), for stdio serving via `serveStdio`. Reuses
   * the exact existing tool-definition JSON schemas (`fromJsonSchema` + the
   * no-op-validating `PASSTHROUGH_JSON_SCHEMA_VALIDATOR`) so `tools/list`/`prompts/list`
   * stay byte-identical to Step 1's golden fixture, and reuses `executeToolInternal`/
   * `generatePrompt`/`discoverAllResources`/`handleToolResultSchema`'s underlying logic
   * verbatim (Constraints: business logic preserved, not rewritten) — only the protocol
   * envelope (JSON-RPC dispatch vs SDK registration) changes. Does not yet touch the
   * HTTP/"SSE" transport (Step 3) — this method is invoked only by `buildMcpServer` for
   * the stdio path.
   */
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
          // IMCPPromptResult's role field (MessageRole enum: USER, ASSISTANT, or SYSTEM) is
          // nominally wider than the SDK's user-or-assistant role restriction, but
          // `generatePrompt` only ever emits MessageRole.USER (confirmed: grep of every
          // prompts.ts generator) — safe structural cast, not a behavior change.
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
   * Verifies a Bearer token against the configured static shared secret (Step 4),
   * satisfying the SDK's `OAuthTokenVerifier` contract for `requireBearerAuth`.
   *
   * Design (Pre-Gap Analysis GAP-1): Exaix has no credential/session/access-token
   * model anywhere in the repo to ground a fuller verifier in — the only
   * credential-adjacent primitive, `SecureCredentialStore`, is an unrelated
   * per-process secret-obfuscation store for provider API keys. This is therefore
   * a deliberately minimal, correct mechanism for this tool's actual threat model
   * (a single-operator, localhost-primary MCP server, not a multi-tenant OAuth
   * deployment): the shared secret lives in the environment variable named by
   * `mcp.auth_token_env` (env-var indirection, never in plaintext config — the same
   * convention as `ai_openrouter.api_key_env`), compared via constant-time equality
   * (`constantTimeEqual`, never `===`). On match the returned `AuthInfo` ALWAYS
   * sets `expiresAt` (GAP-2: the SDK's verifier contract rejects tokens whose
   * `expiresAt` is unset) to a far-future epoch, since a static shared secret has no
   * natural expiry; on mismatch it throws `OAuthError` with
   * `OAuthErrorCode.InvalidToken`, which `requireBearerAuth` maps to a 401
   * `WWW-Authenticate: Bearer error="invalid_token"` challenge. RFC 9728 metadata
   * serving (see `buildHttpFetch`) completes only the resource-server verification
   * half of RFC 9728 — deliberately NOT a token-issuance authorization server,
   * which Exaix does not need or operate.
   */
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

  /**
   * RFC 9728 protected-resource metadata options for the current request (Step 4).
   * The issuer/resource-server URL is derived from the request's own origin — the
   * server binds `localhost` only (`startHTTPServer`'s `hostname: "localhost"`), so
   * the derived issuer always satisfies the SDK's HTTPS-or-loopback rule (GAP-2:
   * `dangerouslyAllowInsecureIssuerUrl` is never surfaced through any Exaix config;
   * the issuer is always HTTPS or a loopback address by construction). The
   * `OAuthMetadata`'s AS endpoints point at the server's own origin because, for a
   * static shared-secret deployment, the server itself is the token authority —
   * only the resource-server half of RFC 9728 is served, no token-issuance endpoints
   * are implemented.
   */
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

  /**
   * Builds the composed web-standard `fetch` handler for MCP-over-HTTP (Steps 3-4):
   * SDK Host/Origin validation (DNS-rebinding/CSRF defense, replacing the hand-rolled
   * `isLoopbackHost`/`rejectUnsafeOrigin` this step retires) → the unrelated, unaffected
   * trace-streaming route (`sse_handler.ts`, never part of the MCP protocol surface) →
   * the official SDK's `createMcpHandler`-built MCP JSON-RPC dispatch → Exaix's own
   * CSP/X-Frame-Options/nosniff header set (`addSecurityHeaders`, which the SDK has no
   * equivalent for, so it is kept and wraps every response). `legacy: "stateless"` is the
   * SDK's own default: each 2025-era (non-envelope) request — which is what every one of
   * Exaix's current clients sends, since none negotiate the 2026-07-28 envelope — is
   * answered by a fresh instance from the same factory over a stateless Streamable HTTP
   * transport; this matches the Constraints note that current clients already speak plain
   * POST/JSON, not real SSE, and required no `'reject'`-mode justification. One
   * SDK-intrinsic, unavoidable behavior change from the hand-rolled path: real Streamable
   * HTTP (per the spec, for both the modern and 2025-era legacy leg) always frames a
   * response as a single-event SSE stream (`Content-Type: text/event-stream`), never a
   * bare `application/json` body — confirmed empirically against the vendored SDK; this
   * is the actual spec behavior this phase migrates onto, not a regression.
   *
   * Step 4 (auth): when `mcp.require_auth` is enabled, the composition additionally
   * (a) fails fast at build time if the token env var is unset — an operator who opts
   * in but forgets the secret gets a boot-time error, not a server that 401s every
   * request — (b) serves RFC 9728 protected-resource metadata at
   * `/.well-known/oauth-protected-resource` (and the RFC 8414 AS document) and (c)
   * gates the MCP dispatch behind `requireBearerAuth({ verifier: this })`, forwarding
   * the verified `AuthInfo` into `handler.fetch(request, { authInfo })` so tool
   * handlers see it via `ctx.http.authInfo`. When `mcp.require_auth` is false (the
   * default), behavior is byte-identical to pre-Step-4: no metadata routes, no gate,
   * no header checks beyond the existing Host/Origin validation.
   */
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

      if (authGate) {
        const metadata = oauthMetadataResponse(request, this.buildAuthMetadataOptions(request));
        if (metadata) {
          return this.addSecurityHeaders(metadata);
        }
      }

      const url = new URL(request.url);
      if (SseHandler.matchesTraceIdRoute(url.pathname)) {
        return this.addSecurityHeaders(sseHandler.handleRequest(request));
      }

      if (authGate) {
        const auth = await authGate(request);
        if (auth instanceof Response) {
          return this.addSecurityHeaders(auth);
        }
        const response = await handler.fetch(request, { authInfo: auth });
        return this.addSecurityHeaders(response);
      }

      const response = await handler.fetch(request);
      return this.addSecurityHeaders(response);
    };
  }

  /**
   * Starts HTTP server for MCP over HTTP/SSE transport. Only available when transport is
   * configured as "sse". Returns the actual bound port (useful when `port` is `0` for an
   * OS-assigned ephemeral port, e.g. in tests).
   */
  startHTTPServer(port: number = 3000): number {
    if (this.transport !== "sse") {
      throw new Error("HTTP server only available for SSE transport");
    }

    if (this.running) {
      throw new Error("MCP Server is already running");
    }

    this.running = true;

    // Deno.serve() returns its handle synchronously (not a Promise) — Pre-Gap Analysis
    // GAP-9: retained on the instance so stop() can actually close the listener, unlike
    // the pre-migration fire-and-forget call that discarded it.
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

/**
 * Builds the official-SDK `McpServer` factory Step 2's `serveStdio(buildMcpServer)`
 * consumes (`apps/mcp-server/main.ts`). Constructs the same `MCPServer` this file has
 * always built (reusing its constructor's context/config/permissions/tool-registration
 * logic verbatim) and adapts it onto the SDK via `buildSdkServer()`.
 */
export function buildMcpServer(options: ConstructorParameters<typeof MCPServer>[0]): McpServer {
  const mcpServer = new MCPServer(options);
  return mcpServer.buildSdkServer();
}
