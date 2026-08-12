/**
 * @module ExternalMcpClient
 * @path packages/mcp/src/external_mcp_client.ts
 * @description Thin, typed wrapper around the official MCP TypeScript SDK's
 * `Client`: construct once per connection, negotiate a transport (Streamable
 * HTTP first, legacy SSE fallback), and expose exactly the verbs
 * `IExternalMcpClient` needs. All protocol mechanics — handshake/discovery,
 * JSON-RPC framing, pagination, error mapping — are delegated entirely to the
 * SDK; this class contains zero wire-protocol logic, only the fallback
 * sequencing and the type mapping to Exaix's own `IExternalMcpClient` shape.
 * @architectural-layer MCP
 * @dependencies [@modelcontextprotocol/client, @exaix/core]
 * @related-files [packages/mcp/src/i_external_mcp_client.ts, packages/mcp/src/i_mcp_client.ts]
 */

import {
  type AuthProvider,
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { BINARY_VERSION } from "@exaix/core/version.ts";
import { DEFAULT_MCP_SERVER_NAME } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type {
  ExternalMcpTransportKind,
  IExternalMcpCallResult,
  IExternalMcpClient,
  IExternalMcpConnectOptions,
  IExternalMcpToolDefinition,
} from "./i_external_mcp_client.ts";

/**
 * Injectable transport/client constructors — mirrors the existing DI pattern in
 * `apps/exactl/src/commands/daemon_commands.ts` (`context.Command ?? Deno.Command`) —
 * so unit tests can substitute the classes (e.g. to spy on construction order)
 * without changing real connection behavior; the cutover step still exercises
 * the real, unsubstituted classes end-to-end.
 */
export interface IExternalMcpClientDeps {
  ClientCtor?: typeof Client;
  StreamableHTTPTransportCtor?: typeof StreamableHTTPClientTransport;
  SSETransportCtor?: typeof SSEClientTransport;
}

export class ExternalMcpClient implements IExternalMcpClient {
  private readonly ClientCtor: typeof Client;
  private readonly StreamableHTTPTransportCtor: typeof StreamableHTTPClientTransport;
  private readonly SSETransportCtor: typeof SSEClientTransport;
  private client: Client | undefined;
  private _activeTransport: ExternalMcpTransportKind | undefined;

  constructor(deps: IExternalMcpClientDeps = {}) {
    this.ClientCtor = deps.ClientCtor ?? Client;
    this.StreamableHTTPTransportCtor = deps.StreamableHTTPTransportCtor ?? StreamableHTTPClientTransport;
    this.SSETransportCtor = deps.SSETransportCtor ?? SSEClientTransport;
  }

  get activeTransport(): ExternalMcpTransportKind | undefined {
    return this._activeTransport;
  }

  async connect(endpoint: URL, options?: Opt<IExternalMcpConnectOptions, Reason.OptionalInput>): Promise<void> {
    const authProvider: AuthProvider | undefined = options?.bearerToken
      ? { token: () => Promise.resolve(options.bearerToken) }
      : undefined;
    const streamableAttempt = new this.ClientCtor({ name: DEFAULT_MCP_SERVER_NAME, version: BINARY_VERSION });
    try {
      await streamableAttempt.connect(new this.StreamableHTTPTransportCtor(endpoint, { authProvider }));
      this.client = streamableAttempt;
      this._activeTransport = "streamable-http";
      return;
    } catch (streamableError) {
      // Per the SDK's own documented requirement, a failed Client cannot be
      // reused for a second transport attempt — a fresh instance is required.
      const sseAttempt = new this.ClientCtor({ name: DEFAULT_MCP_SERVER_NAME, version: BINARY_VERSION });
      try {
        await sseAttempt.connect(new this.SSETransportCtor(endpoint, { authProvider }));
        this.client = sseAttempt;
        this._activeTransport = "sse";
        return;
      } catch (sseError) {
        const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
        const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
        throw new Error(
          `ExternalMcpClient: both transports failed to connect to ${endpoint}. ` +
            `Streamable HTTP: ${streamableMessage}. SSE: ${sseMessage}.`,
        );
      }
    }
  }

  async listTools(): Promise<IExternalMcpToolDefinition[]> {
    const { tools } = await this.connectedClient().listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, JSONValue>,
    }));
  }

  async callTool(name: string, args: Record<string, JSONValue>): Promise<IExternalMcpCallResult> {
    const result = await this.connectedClient().callTool({ name, arguments: args });
    return {
      content: result.content as IExternalMcpCallResult["content"],
      structuredContent: result.structuredContent as JSONValue | undefined,
      isError: result.isError,
    };
  }

  async close(): Promise<void> {
    await this.client?.close();
    // Clear the reference so a subsequent call observably fails instead of
    // silently succeeding against a closed transport (the SDK's own
    // `listTools()`/`callTool()` degrade gracefully post-close rather than
    // rejecting, which would otherwise hide a real "torn down" bug).
    this.client = undefined;
    this._activeTransport = undefined;
  }

  private connectedClient(): Client {
    if (!this.client) {
      throw new Error("ExternalMcpClient: not connected — call connect() before using this method");
    }
    return this.client;
  }
}
