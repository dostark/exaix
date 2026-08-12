/**
 * @module LegacySseReferenceServerFixture
 * @path packages/mcp/tests/fixtures/legacy_sse_reference_server.ts
 * @description Minimal hand-rolled legacy-SSE MCP server fixture — NOT the
 * official SDK. The v2 `@modelcontextprotocol/server` SDK never serves the
 * legacy HTTP+SSE transport (per its own migration docs), so this fixture
 * implements only the bare wire shape `SSEClientTransport` needs, modeled
 * precisely on the real, currently-deployed contract read from
 * `docker/mcp-server/server/server.py`: `GET /sse` opens an `EventSource`
 * and announces a POST endpoint via an `event: endpoint` message; `POST
 * /messages` accepts outbound JSON-RPC requests, with responses delivered
 * back over the still-open SSE stream. Deliberately NOT a second full SDK
 * generation for legacy support (`@modelcontextprotocol/sdk`, v1, is the one
 * documented to still speak it) — pulling in a second SDK generation purely
 * for a test fixture is disproportionate to this phase's scope. Test-only
 * code — never imported by production `packages/mcp/src/`.
 * @architectural-layer MCP
 * @dependencies []
 * @related-files [packages/mcp/tests/external_mcp_client_test.ts, packages/mcp/tests/fixtures/reference_mcp_server.ts]
 */

export interface ILegacySseServerHandle {
  readonly url: URL;
  stop(): Promise<void>;
}

/**
 * Starts a minimal legacy-SSE-shaped MCP server on an ephemeral local port
 * (or the given `port`). Only understands `initialize` and `tools/list` —
 * enough to let `SSEClientTransport.connect()` succeed for fallback testing;
 * any HTTP method/path other than `GET /sse` and `POST /messages` 404s,
 * which is what makes a same-URL Streamable HTTP attempt fail first.
 */
export function startLegacySseReferenceServer(port: number = 0): Promise<ILegacySseServerHandle> {
  const encoder = new TextEncoder();
  let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const sendSseMessage = (event: string | undefined, data: string): void => {
    const framed = `${event ? `event: ${event}\n` : ""}data: ${data}\n\n`;
    sseController?.enqueue(encoder.encode(framed));
  };

  const handleGetSse = (): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
        sendSseMessage("endpoint", "/messages");
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  };

  const handlePostMessages = async (req: Request) => {
    const body = await req.json();
    if (body.method === "initialize") {
      sendSseMessage(
        undefined,
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "exaix-legacy-sse-fixture", version: "1.0.0" },
          },
        }),
      );
    } else if (body.method === "tools/list") {
      sendSseMessage(undefined, JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
    }
    return new Response(null, { status: 202 });
  };

  const httpServer = Deno.serve({ port, onListen: () => {} }, (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/sse") return handleGetSse();
    if (req.method === "POST" && url.pathname === "/messages") return handlePostMessages(req);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  const { port: boundPort } = httpServer.addr as Deno.NetAddr;
  return Promise.resolve({
    url: new URL(`http://127.0.0.1:${boundPort}/sse`),
    stop: () => httpServer.shutdown(),
  });
}
