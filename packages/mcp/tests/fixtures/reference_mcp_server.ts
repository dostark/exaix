/**
 * @module ReferenceMcpServerFixture
 * @path packages/mcp/tests/fixtures/reference_mcp_server.ts
 * @description Real Streamable HTTP MCP server fixture built with the
 * official `@modelcontextprotocol/server` SDK (`McpServer` + `registerTool`,
 * per `docs/get-started/first-server.md`'s documented pattern) and served via
 * `Deno.serve` on a real local port — never a mock. Registers three
 * deterministic tools covering the phase's test matrix: `echo` (returns its
 * input as text content), `fail` (always returns `isError: true`), and
 * `totals` (declares an `outputSchema`, exercising `structuredContent`
 * round-tripping). Test-only code — never imported by production
 * `packages/mcp/src/`.
 * @architectural-layer MCP
 * @dependencies [@modelcontextprotocol/server, zod]
 * @related-files [packages/mcp/tests/external_mcp_client_test.ts, packages/mcp/tests/fixtures/reference_mcp_server_test.ts]
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface IReferenceServerHandle {
  readonly url: URL;
  stop(): Promise<void>;
}

/** Reused by tests asserting on the exact echoed-text shape. */
export const ECHO_TOOL_TEXT_PREFIX = "echo: ";
/** Reused by tests asserting on the exact structuredContent shape. */
export const STRUCTURED_TOOL_CURRENCY = "USD";

/** Real, official-SDK-backed MCP server registering `echo`/`fail`/`totals`, on an
 *  ephemeral local port unless `port` is given. */
export function startReferenceServer(port: number = 0): Promise<IReferenceServerHandle> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "exaix-mcp-reference-server", version: "1.0.0" });

    server.registerTool(
      "echo",
      { description: "Echoes its input back", inputSchema: z.object({ text: z.string() }) },
      ({ text }) => Promise.resolve({ content: [{ type: "text", text: `${ECHO_TOOL_TEXT_PREFIX}${text}` }] }),
    );

    server.registerTool(
      "fail",
      { description: "Always returns isError: true", inputSchema: z.object({}) },
      () => Promise.resolve({ content: [{ type: "text", text: "deliberate failure" }], isError: true }),
    );

    server.registerTool(
      "totals",
      {
        description: "Returns a structured total alongside its text content",
        inputSchema: z.object({ amount: z.number() }),
        outputSchema: z.object({ amount: z.number(), currency: z.string() }),
      },
      ({ amount }) =>
        Promise.resolve({
          content: [{ type: "text", text: `Total: ${amount} ${STRUCTURED_TOOL_CURRENCY}` }],
          structuredContent: { amount, currency: STRUCTURED_TOOL_CURRENCY },
        }),
    );

    return server;
  });

  const httpServer = Deno.serve({ port, onListen: () => {} }, (req) => handler.fetch(req));
  const { port: boundPort } = httpServer.addr as Deno.NetAddr;
  return Promise.resolve({
    url: new URL(`http://127.0.0.1:${boundPort}/mcp`),
    stop: async () => {
      await handler.close();
      await httpServer.shutdown();
    },
  });
}
