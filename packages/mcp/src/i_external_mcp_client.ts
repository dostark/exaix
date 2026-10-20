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
import type { Opt, Reason } from "@exaix/core/types";

export interface IExternalMcpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, JSONValue>;
}

export interface IExternalMcpCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** Present only when a tool with `outputSchema` returns it. The SDK exposes `unknown` in `docs/clients/calling.md`.
   * `docs/CODE_STYLE.md` requires a stored JSON type. Protocol content is JSON, so `JSONValue` preserves that contract.
   */
  structuredContent?: JSONValue;
  isError?: boolean;
}

export interface IExternalMcpConnectOptions {
  /** Attached via the SDK's `AuthProvider` primitive — the only auth mode supported. No
   *  interactive OAuth or client_credentials/JWT-assertion grants. */
  bearerToken?: string;
}

export interface IExternalMcpClient {
  /** Connects, trying Streamable HTTP first and falling back to legacy SSE on failure. */
  connect(endpoint: URL, options?: Opt<IExternalMcpConnectOptions, Reason.OptionalInput>): Promise<void>;
  listTools(): Promise<IExternalMcpToolDefinition[]>;
  callTool(name: string, args: Record<string, JSONValue>): Promise<IExternalMcpCallResult>;
  /** Which transport actually connected — "streamable-http" | "sse" — for logging/diagnostics. */
  readonly activeTransport: ExternalMcpTransportKind | undefined;
  close(): Promise<void>;
}

export type ExternalMcpTransportKind = "streamable-http" | "sse";
