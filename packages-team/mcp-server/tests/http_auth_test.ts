/**
 * @module MCPHTTPAuthTest
 * @path packages-team/mcp-server/tests/http_auth_test.ts
 * @related-files [packages-team/mcp-server/server.ts, packages-team/mcp-server/tests/http_security_test.ts]
 * @architectural-layer MCP
 * @description Verifies Phase 163 Step 4's config-gated Bearer-token auth on the MCP HTTP
 * transport: off-by-default unauthenticated behavior, 401 rejection of missing/invalid
 * tokens, a valid token's AuthInfo reaching the SDK dispatch, verifyAccessToken's
 * AuthInfo.expiresAt contract, and RFC 9728 protected-resource metadata serving
 * (when auth is enabled).
 */

import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";

import { MCPServer } from "@exaix-team/mcp-server";
import { initTestDbService } from "@exaix/testing";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { IApplicationContext } from "@exaix/core/types";

async function cleanupAuditFolder(config: Config): Promise<void> {
  try {
    const runtimeDir = config?.paths?.runtime || ".";
    await Deno.remove(join(runtimeDir, "audit"), { recursive: true });
  } catch {
    // Ignore if audit folder doesn't exist or can't be removed.
  }
}

interface IWithMCPServerAuthOptions {
  requireAuth?: boolean;
  /** Value to set the configured auth-token env var to; omit to leave it unset. */
  authTokenValue?: string;
  /** Value for `mcp.auth_token_expiry_seconds`; omit to leave the config default. */
  authTokenExpirySeconds?: number;
}

/** Builds an SSE-transport MCPServer with `mcp.require_auth`/`mcp.auth_token_env` configured, restoring the env var afterward. */
async function withMCPServerAuth(
  options: IWithMCPServerAuthOptions,
  fn: (ctx: { server: MCPServer; config: Config }) => void | Promise<void>,
): Promise<void> {
  const { db, config, cleanup } = await initTestDbService();
  config.mcp.transport = McpTransportType.SSE;
  if (options.requireAuth !== undefined) config.mcp.require_auth = options.requireAuth;
  if (options.authTokenExpirySeconds !== undefined) {
    config.mcp.auth_token_expiry_seconds = options.authTokenExpirySeconds;
  }
  const envName = config.mcp.auth_token_env;
  const previousEnvValue = Deno.env.get(envName);
  if (options.authTokenValue !== undefined) {
    Deno.env.set(envName, options.authTokenValue);
  } else {
    Deno.env.delete(envName);
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
      transport: McpTransportType.SSE,
      permissions: new AllowAllPermissionsService(),
    });
    await fn({ server, config });
  } finally {
    if (previousEnvValue === undefined) Deno.env.delete(envName);
    else Deno.env.set(envName, previousEnvValue);
    await cleanup();
    await cleanupAuditFolder(config);
  }
}

function toolsListRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Host": "localhost:3000",
      "Accept": "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

Deno.test("[MCPServer auth] with mcp.require_auth=false (default), the endpoint serves unauthenticated exactly as before", async () => {
  await withMCPServerAuth({ requireAuth: false }, async ({ server }) => {
    const response = await server.buildHttpFetch()(toolsListRequest());
    assertEquals(response.status, 200);
  });
});

Deno.test("[security][MCPServer auth] with mcp.require_auth=true, a request with no bearer token gets 401 invalid_token", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    const response = await server.buildHttpFetch()(toolsListRequest());
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, "invalid_token");
    assertExists(response.headers.get("WWW-Authenticate"));
  });
});

Deno.test("[security][MCPServer auth] with mcp.require_auth=true, a request with the wrong bearer token gets 401 invalid_token", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    const response = await server.buildHttpFetch()(toolsListRequest({ Authorization: "Bearer wrong-token" }));
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, "invalid_token");
  });
});

Deno.test("[MCPServer auth] with mcp.require_auth=true, a valid token's authInfo reaches the SDK dispatch and tools/list succeeds", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    const response = await server.buildHttpFetch()(toolsListRequest({ Authorization: "Bearer correct-token" }));
    assertEquals(response.status, 200);
  });
});

Deno.test("[MCPServer auth] verifyAccessToken's returned AuthInfo always sets expiresAt, matching requireBearerAuth's verifier contract", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    const authInfo = await server.verifyAccessToken("correct-token");
    assertExists(authInfo.expiresAt, "AuthInfo.expiresAt must always be set for the static shared-secret token");
    assert(authInfo.expiresAt > Math.floor(Date.now() / 1000), "expiresAt must be in the future");
    assertEquals(authInfo.token, "correct-token");
  });
});

Deno.test("[MCPServer auth] auth_token_expiry_seconds from config is honoured in verifyAccessToken's AuthInfo.expiresAt", async () => {
  await withMCPServerAuth(
    { requireAuth: true, authTokenValue: "correct-token", authTokenExpirySeconds: 60 },
    async ({ server }) => {
      const before = Math.floor(Date.now() / 1000);
      const authInfo = await server.verifyAccessToken("correct-token");
      assertExists(authInfo.expiresAt, "AuthInfo.expiresAt must be set");
      // A custom 60-second lifetime must yield a near-future expiry (now + 60), not the ~100-year default.
      assert(
        authInfo.expiresAt >= before + 60 && authInfo.expiresAt < before + 120,
        `expected expiresAt ~now+60s, got ${authInfo.expiresAt} (now=${before})`,
      );
    },
  );
});

Deno.test("[security][MCPServer auth] verifyAccessToken rejects an unknown token with OAuthErrorCode.InvalidToken", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    try {
      await server.verifyAccessToken("wrong-token");
      throw new Error("expected verifyAccessToken to throw");
    } catch (error) {
      assert(error instanceof OAuthError, "must throw an OAuthError");
      assertEquals((error as OAuthError).code, OAuthErrorCode.InvalidToken);
    }
  });
});

Deno.test("[MCPServer auth] building the HTTP fetch handler with require_auth=true and no configured token fails fast", async () => {
  await withMCPServerAuth({ requireAuth: true }, ({ server }) => {
    // require_auth only gates the HTTP path (stdio cannot carry a Bearer header), so the
    // fail-fast lives at buildHttpFetch() — where the gate is composed — not in the
    // constructor, which also serves stdio.
    assertThrows(() => server.buildHttpFetch(), Error, "auth_token_env");
  });
});

Deno.test("[MCPServer auth] with mcp.require_auth=true, RFC 9728 protected-resource metadata is served at /.well-known/oauth-protected-resource", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    const response = await server.buildHttpFetch()(
      new Request("http://localhost:3000/.well-known/oauth-protected-resource", {
        method: "GET",
        headers: { "Host": "localhost:3000" },
      }),
    );
    assertEquals(response.status, 200);
    const doc = await response.json();
    assertEquals(doc.resource, "http://localhost:3000/");
    assertEquals(doc.authorization_servers, ["http://localhost:3000"]);
  });
});

Deno.test("[security][MCPServer auth] with mcp.require_auth=true, the SSE trace-stream route is reachable without a bearer token (Phase 170 Weakness 2)", async () => {
  await withMCPServerAuth({ requireAuth: true, authTokenValue: "correct-token" }, async ({ server }) => {
    // The trace-stream route is dispatched in buildHttpFetch() before the authGate check runs
    // (server.ts's SseHandler.matchesTraceIdRoute branch returns early, bypassing authGate
    // entirely). This regression test targets that ordering bug: it must be impossible to reach
    // the SSE handler's own internal validation (400 for an invalid trace id) without first
    // passing the bearer-auth gate (401). An intentionally-invalid trace id keeps the assertion
    // safe/deterministic -- it never opens a real SseHandler.streamEvents() subscription, so
    // there is no live stream to clean up.
    const response = await server.buildHttpFetch()(
      new Request("http://localhost:3000/api/v1/traces/not-a-valid-trace-id/stream", {
        method: "GET",
        headers: { "Host": "localhost:3000" },
      }),
    );
    assertEquals(
      response.status,
      401,
      `expected 401 (bearer auth required, none supplied) but got ${response.status} -- ` +
        "the SSE trace-stream route bypasses authGate entirely (dispatched before the auth check in buildHttpFetch())",
    );
  });
});
