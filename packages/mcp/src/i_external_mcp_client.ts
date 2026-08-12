/**
 * @module IExternalMcpClient
 * @path packages/mcp/src/i_external_mcp_client.ts
 * @description Outbound MCP client contract: a real wire-protocol connection to
 * an external MCP server (dual-transport — Streamable HTTP primary, legacy SSE
 * fallback). Deliberately separate from `IMcpClient`
 * (`packages/mcp/src/i_mcp_client.ts`), which is a local, in-process dispatch
 * facade over Exaix's own closed `McpToolName` enum and never opens a network
 * connection. `IExternalMcpClient` is string-keyed (arbitrary external tool
 * names), not `McpToolName`-keyed — see phase-162's Constraints for the
 * rationale.
 * @architectural-layer MCP
 * @dependencies [@exaix/core]
 * @related-files [packages/mcp/src/i_mcp_client.ts]
 */

import type { JSONValue } from "@exaix/core";

export interface IExternalMcpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, JSONValue>;
}

export interface IExternalMcpCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** Present when the called tool declares an `outputSchema`. The official SDK types this `unknown` (`docs/clients/calling.md`); Exaix's `CODE_STYLE.md` forbids storing a bare `unknown` field, so it is narrowed to `JSONValue` here — a safe fit since MCP content is JSON-serialized by protocol definition. Omitted (not silently dropped) when the server does not return it. */
  structuredContent?: JSONValue;
  isError?: boolean;
}

export interface IExternalMcpConnectOptions {
  /**
   * Bearer token attached via the SDK's `AuthProvider` primitive (`{ token: () =>
   * Promise<string | undefined> }`, `docs/clients/machine-auth.md`'s "bring your own
   * bearer token" pattern) — the only auth mode this phase supports. No interactive
   * OAuth (`OAuthClientProvider`) or `client_credentials`/JWT-assertion grants.
   */
  bearerToken?: string;
}

export interface IExternalMcpClient {
  /** Connects, trying Streamable HTTP first and falling back to legacy SSE on failure. */
  connect(endpoint: URL, options?: IExternalMcpConnectOptions): Promise<void>;
  listTools(): Promise<IExternalMcpToolDefinition[]>;
  callTool(name: string, args: Record<string, JSONValue>): Promise<IExternalMcpCallResult>;
  /** Which transport actually connected — "streamable-http" | "sse" — for logging/diagnostics. */
  readonly activeTransport: ExternalMcpTransportKind | undefined;
  close(): Promise<void>;
}

export type ExternalMcpTransportKind = "streamable-http" | "sse";
