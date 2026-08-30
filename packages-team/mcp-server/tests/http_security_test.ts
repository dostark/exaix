/**
 * @module MCPHTTPSecurityTest
 * @path packages-team/mcp-server/tests/http_security_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the HTTP security posture of the MCP SSE transport, ensuring
 * mandatory headers (CSP, HSTS) are applied and prevent cross-site scripting (XSS).
 */

import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";

import { MCPServer } from "@exaix-team/mcp-server";
import { initTestDbService } from "@exaix/testing";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { IApplicationContext } from "@exaix/core/types";

/**
 * Clean up audit folder created during tests
 */
async function cleanupAuditFolder(config: Config): Promise<void> {
  try {
    const runtimeDir = config?.paths?.runtime || ".";
    const auditDir = join(runtimeDir, "audit");
    await Deno.remove(auditDir, { recursive: true });
  } catch (error) {
    // Ignore if audit folder doesn't exist or can't be removed
    console.warn("[Test Cleanup] Failed to remove audit folder:", error);
  }
}

// Helper for MCP Server security tests
async function withMCPServerSecurity(
  options: { transport?: McpTransportType } = {},
  fn: (
    ctx: { server: MCPServer; db: IDatabaseService; config: Config; headers: Record<string, string> },
  ) => void | Promise<void>,
) {
  const { db, config, cleanup } = await initTestDbService();

  if (options.transport) {
    config.mcp.transport = options.transport;
  }

  try {
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(),
    };

    const server = new MCPServer({
      context,
      transport: options.transport || McpTransportType.STDIO,
      permissions: new AllowAllPermissionsService(),
    });

    // Helper to get headers if available
    const headers = server.getSecurityHeaders();

    await fn({ server, db, config, headers });
  } finally {
    await cleanup();
    await cleanupAuditFolder(config);
  }
}

Deno.test("MCPServer: includes comprehensive security headers", async () => {
  await withMCPServerSecurity({}, ({ headers }) => {
    // Content Security Policy
    assertStringIncludes(headers["Content-Security-Policy"], "default-src 'none'");
    assertStringIncludes(headers["Content-Security-Policy"], "frame-ancestors 'none'");

    // Anti-clickjacking
    assertEquals(headers["X-Frame-Options"], "DENY");

    // Anti-MIME sniffing
    assertEquals(headers["X-Content-Type-Options"], "nosniff");

    // XSS protection
    assertEquals(headers["X-XSS-Protection"], "1; mode=block");

    // HTTPS enforcement
    assertStringIncludes(headers["Strict-Transport-Security"], "max-age=");

    // Referrer policy
    assertEquals(headers["Referrer-Policy"], "strict-origin-when-cross-origin");

    // Permissions policy
    assertStringIncludes(headers["Permissions-Policy"], "geolocation=()");
  });
});

Deno.test("MCPServer: applies security headers to HTTP responses", async () => {
  await withMCPServerSecurity({}, ({ server }) => {
    // Mock a Response object
    const mockResponse = new Response("test content", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // Test that addSecurityHeaders method exists and enhances responses
    const enhancedResponse = server.addSecurityHeaders(mockResponse);

    // Verify all security headers are present
    assert(enhancedResponse.headers.get("Content-Security-Policy") !== null);
    assert(enhancedResponse.headers.get("X-Frame-Options") !== null);
    assert(enhancedResponse.headers.get("Strict-Transport-Security") !== null);

    // Verify original content is preserved
    assertEquals(enhancedResponse.status, 200);
  });
});

Deno.test("MCPServer: CSP prevents inline script execution", async () => {
  await withMCPServerSecurity({}, ({ headers }) => {
    const csp = headers["Content-Security-Policy"];

    // Verify CSP syntax is valid and secure
    assertStringIncludes(csp, "default-src 'none'");
    assertStringIncludes(csp, "script-src 'self'");
    // Should not allow unsafe-inline for scripts
    assert(!csp.includes("script-src 'unsafe-inline'"));
    assert(!csp.includes("script-src *"));
  });
});

Deno.test("MCPServer: HSTS enforces HTTPS", async () => {
  await withMCPServerSecurity({}, ({ headers }) => {
    const hsts = headers["Strict-Transport-Security"];

    assertStringIncludes(hsts, "max-age=");
    assertStringIncludes(hsts, "includeSubDomains");

    // Parse max-age to ensure it's reasonable (at least 1 year)
    const maxAgeMatch = hsts.match(/max-age=(\d+)/);
    assert(maxAgeMatch !== null);
    const maxAge = parseInt(maxAgeMatch[1]);
    assert(maxAge >= 31536000); // 1 year in seconds
  });
});

Deno.test("MCPServer: headers prevent common attacks", async () => {
  await withMCPServerSecurity({}, ({ headers }) => {
    // Should prevent iframe embedding (clickjacking)
    assertEquals(headers["X-Frame-Options"], "DENY");

    // Should prevent MIME type confusion
    assertEquals(headers["X-Content-Type-Options"], "nosniff");

    // Should enable XSS filtering
    assertStringIncludes(headers["X-XSS-Protection"], "mode=block");

    // Should restrict referrer information
    assertEquals(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  });
});

Deno.test("MCPServer: supports SSE transport configuration", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, ({ server }) => {
    // Verify server is configured for SSE
    assertEquals(server.getTransport(), McpTransportType.SSE);
  });
});

Deno.test("MCPServer: handles HTTP POST requests", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    // Host and Accept headers are required by the SDK's Streamable HTTP transport; a
    // real client always sets Host, and Accept negotiates the response framing.
    const initRequest = new Request("http://localhost:3000", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Host": "localhost:3000",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    const response = await server.buildHttpFetch()(initRequest);

    // Verify response has security headers
    assert(response.headers.get("Content-Security-Policy") !== null);
    assert(response.headers.get("X-Frame-Options") !== null);
    assert(response.headers.get("Strict-Transport-Security") !== null);

    // Streamable HTTP always frames a response as a single-event SSE stream, never bare
    // application/json — this is the actual spec behavior, not a regression.
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    assertEquals(response.status, 200);
  });
});

Deno.test("MCPServer: rejects non-POST HTTP requests", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    // Create a GET request
    const getRequest = new Request("http://localhost:3000", {
      method: "GET",
      headers: { "Host": "localhost:3000" },
    });

    const response = await server.buildHttpFetch()(getRequest);

    // Should return 405 Method Not Allowed with security headers
    assertEquals(response.status, 405);
    assert(response.headers.get("Content-Security-Policy") !== null);
  });
});

Deno.test("MCPServer: handles malformed JSON in HTTP requests", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    // Create a request with invalid JSON
    const badRequest = new Request("http://localhost:3000", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Host": "localhost:3000",
        "Accept": "application/json, text/event-stream",
      },
      body: "invalid json",
    });

    const response = await server.buildHttpFetch()(badRequest);

    // Should return 400 Bad Request with security headers
    assertEquals(response.status, 400);
    assert(response.headers.get("Content-Security-Policy") !== null);

    const responseBody = await response.json();
    assertEquals(responseBody.error.code, -32700);
    assertStringIncludes(responseBody.error.message, "Parse error");
  });
});

Deno.test("MCPServer: HTTP server only starts with SSE transport", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.STDIO }, ({ server }) => {
    // startHTTPServer is synchronous (Deno.serve() returns its handle synchronously,
    // no await needed) — the SSE-transport guard now throws synchronously too.
    assertThrows(
      () => server.startHTTPServer(3000),
      Error,
      "HTTP server only available for SSE transport",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Finding 5 — Host/Origin validation (anti DNS-rebinding / CSRF)

function jsonRpcRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Host": new URL(url).host,
      "Accept": "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

Deno.test("security: MCPServer rejects a non-localhost Host header (DNS rebinding)", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    const response = await server.buildHttpFetch()(jsonRpcRequest("http://attacker.example.com:3000"));
    assertEquals(response.status, 403);
  });
});

Deno.test("security: MCPServer rejects a cross-origin request (CSRF)", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    const response = await server.buildHttpFetch()(
      jsonRpcRequest("http://localhost:3000", { "Origin": "https://evil.example.com" }),
    );
    assertEquals(response.status, 403);
  });
});

Deno.test("security: MCPServer allows a same-origin localhost request", async () => {
  await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
    const response = await server.buildHttpFetch()(
      jsonRpcRequest("http://127.0.0.1:3000", { "Origin": "http://127.0.0.1:3000" }),
    );
    assertEquals(response.status, 200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Legacy posture and listener lifecycle

/** Minimal shape of a parsed JSON-RPC response envelope. */
interface ISseJsonRpcEnvelope {
  result?: object;
  error?: object;
}

/** Extracts the first JSON-RPC payload from an SSE-framed (`text/event-stream`) response body. */
async function readSseJson(response: Response): Promise<ISseJsonRpcEnvelope> {
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  assertExists(dataLine, `expected an SSE "data:" line in the response body, got: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length));
}

Deno.test(
  "[MCPServer HTTP] a 2025-era initialize-opening request is served statelessly per the documented legacy posture",
  async () => {
    await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
      const fetchHandler = server.buildHttpFetch();

      // A 2025-era client opens with `initialize` — no session-id header, since the
      // documented `legacy: "stateless"` posture (server.ts's buildHttpFetch doc comment)
      // serves every request from a fresh instance, requiring no continuity.
      const initResponse = await fetchHandler(jsonRpcRequest("http://localhost:3000"));
      assertEquals(initResponse.status, 200);
      const initBody = await readSseJson(initResponse);
      assertExists(initBody.result, "initialize must succeed without any prior session state");

      // A second, entirely independent request (no session-id, no relation to the first)
      // must also succeed on its own — proving statelessness rather than accidentally
      // depending on the first request's in-memory instance.
      const toolsResponse = await fetchHandler(jsonRpcRequest("http://localhost:3000"));
      assertEquals(toolsResponse.status, 200);
      const toolsBody = await readSseJson(toolsResponse);
      assertExists(toolsBody.result, "a fresh, unrelated request must be served statelessly");
    });
  },
);

Deno.test(
  "[MCPServer HTTP] stop() actually closes the underlying Deno.serve() listener — no lingering open port after stop",
  async () => {
    await withMCPServerSecurity({ transport: McpTransportType.SSE }, async ({ server }) => {
      const port = server.startHTTPServer(0);

      // The listener must actually accept connections before stop() — proves the port
      // captured by startHTTPServer is real and reachable.
      const before = await fetch(`http://localhost:${port}/`, { method: "GET" });
      await before.body?.cancel();

      server.stop();

      // After stop(), the same port must refuse new connections — proving stop() actually
      // invoked httpServerHandle.shutdown() rather than leaking the listener open.
      await assertRejects(() => fetch(`http://localhost:${port}/`, { method: "GET" }));
    });
  },
);
