/**
 * @module AuthenticatedReferenceServerFixture
 * @path packages/mcp/tests/fixtures/authenticated_reference_server.ts
 * @description Real Streamable HTTP MCP server fixture (official
 * `@modelcontextprotocol/server` SDK, `McpServer` + `registerTool`) gated on
 * a bearer token — the outer `Deno.serve` handler rejects any request whose
 * `Authorization` header isn't exactly `Bearer <requiredToken>` with a real
 * HTTP 401 before the request ever reaches `handler.fetch()`, so the SDK's
 * MCP handling underneath is never exercised without a correct token. Never
 * imported by production `packages/mcp/src/`.
 * @architectural-layer MCP
 * @dependencies [@modelcontextprotocol/server, zod]
 * @related-files [packages/mcp/tests/external_mcp_client_test.ts, packages/mcp/src/external_mcp_client.ts]
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface IAuthenticatedServerHandle {
  readonly url: URL;
  stop(): Promise<void>;
}

/** Reused by tests asserting on the exact authenticated identity string. */
export const WHOAMI_TOOL_IDENTITY = "authenticated-caller";

/** Requires `Authorization: Bearer <requiredToken>` on every request; registers one
 *  `whoami` tool once authorized. */
export function startAuthenticatedReferenceServer(
  requiredToken: string,
  port: number = 0,
): Promise<IAuthenticatedServerHandle> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "exaix-authenticated-reference-server", version: "1.0.0" });
    server.registerTool(
      "whoami",
      { description: "Returns the authenticated caller's identity", inputSchema: z.object({}) },
      () => Promise.resolve({ content: [{ type: "text", text: WHOAMI_TOOL_IDENTITY }] }),
    );
    return server;
  });

  const httpServer = Deno.serve({ port, onListen: () => {} }, (req) => {
    if (req.headers.get("authorization") !== `Bearer ${requiredToken}`) {
      return Promise.resolve(new Response("Unauthorized", { status: 401 }));
    }
    return handler.fetch(req);
  });
  const { port: boundPort } = httpServer.addr as Deno.NetAddr;
  return Promise.resolve({
    url: new URL(`http://127.0.0.1:${boundPort}/mcp`),
    stop: async () => {
      await handler.close();
      await httpServer.shutdown();
    },
  });
}
