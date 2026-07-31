/**
 * @module ToolHandlerGitTest
 * @path packages/mcp/tests/tool_handler_git_test.ts
 * @related-files [packages/mcp/server/tool_handler.ts, packages/mcp/testing/test_setup.ts]
 * @architectural-layer MCP
 * @description Phase 156 Step 1 planned test: ToolHandler.resolveGitService
 * returns a per-portal IGitService when context.gitServiceFactory is wired,
 * and throws the documented error when the factory is absent — the detectable
 * failure mode that replaces silent stub values.
 */

import { assert, assertThrows } from "@std/assert";
import { ToolHandler } from "@exaix/mcp/server";
import { createStubContext, createStubGit } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { IGitService, IGitServiceFactory, JSONValue } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";

/** Minimal concrete ToolHandler exposing resolveGitService for probing. */
class ProbeToolHandler extends ToolHandler {
  resolve(portalPath: string): IGitService {
    return this.resolveGitService(portalPath);
  }

  execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    return Promise.resolve({ content: [] });
  }

  getToolDefinition() {
    return { name: "probe", description: "probe handler", inputSchema: {} };
  }
}

const stubFactory: IGitServiceFactory = {
  createGitService: (_repoPath: string, _traceId: string) => createStubGit(),
};

Deno.test("resolveGitService: throws documented error when factory is absent", () => {
  const context = createStubContext();
  const handler = new ProbeToolHandler(context);
  assertThrows(
    () => handler.resolve("/tmp/exa-test"),
    Error,
    "IGitServiceFactory not available in context",
  );
});

Deno.test("resolveGitService: returns a per-portal IGitService when factory is wired", () => {
  const context = createStubContext({ gitServiceFactory: stubFactory }) as ICliApplicationContext;
  const handler = new ProbeToolHandler(context);
  const service = handler.resolve("/tmp/exa-test");
  assert(typeof service.runGitCommand === "function");
  assert(typeof service.validateArgs === "function");
  assert(typeof service.getCurrentBranch === "function");
});
