/**
 * @module MCPTestSetup
 * @path tests/mcp/helpers/test_setup.ts
 * @description Provides common setup routines for MCP server tests, coordinating
 * transport layer (SSE/Stdio) initialization and session creation.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assertEquals, assertExists } from "@std/assert";
import { setupGitRepo } from "../../helpers/git_test_helper.ts";

import { McpTransportType, PortalOperation } from "../../../src/shared/enums.ts";
import { MCPServer } from "../../../src/mcp/server.ts";
import { ToolRegistry } from "../../../src/services/tool/tool_registry.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../../helpers/test_helpers.ts";

import type { IPortalPermissions } from "../../../src/shared/schemas/portal_permissions.ts";
import type { JSONValue } from "../../../src/shared/types/json.ts";
import type { ICliApplicationContext } from "../../../src/cli/cli_context.ts";

export interface IToolPermissionOptions {
  portalAlias?: string;
  operations?: PortalOperation[];
  identityId?: string;
  fileContent?: Record<string, string>;
  initGit?: boolean;
}

export interface IMCPTestContext {
  tempDir: string;
  portalPath: string;
  server: MCPServer;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanup: () => Promise<void>;
}

export interface IPortalTestOptions {
  portalAlias?: string;
  createFiles?: boolean;
  fileContent?: Record<string, string>;
  permissions?: {
    identities_allowed?: string[];
    operations?: string[];
  };
  initGit?: boolean;
}

export interface IToolPermissionTestContext {
  tempDir: string;
  portalPath: string;
  config: ReturnType<typeof createMockConfig>;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  permissions: IPortalPermissions;
  cleanup: () => Promise<void>;
}

export { setupGitRepo };

/**
 * Helper to initialize common test environment (files, git, db, config)
 */
async function initTestEnv(options: IPortalTestOptions & { prefix?: string }) {
  const {
    portalAlias = "TestPortal",
    createFiles = false,
    fileContent = {},
    permissions = {},
    initGit = false,
    prefix = "mcp-test-",
  } = options;

  const tempDir = await Deno.makeTempDir({ prefix });
  const portalPath = join(tempDir, portalAlias);
  await ensureDir(portalPath);

  if (initGit) {
    const resolvedPortalPath = await Deno.realPath(portalPath);
    await setupGitRepo(resolvedPortalPath);
  }

  if (createFiles) {
    await Deno.writeTextFile(join(portalPath, "test.txt"), "content");
  }

  for (const [filename, content] of Object.entries(fileContent)) {
    const filePath = join(portalPath, filename);
    const dir = join(filePath, "..");
    await ensureDir(dir);
    await Deno.writeTextFile(filePath, content);
  }

  const { db, cleanup: dbCleanup } = await initTestDbService();

  const portalConfig = {
    alias: portalAlias,
    target_path: portalPath,
    identities_allowed: permissions.identities_allowed,
    operations: permissions.operations,
  };

  const config = createMockConfig(tempDir, {
    portals: [portalConfig],
  });

  const cleanup = async () => {
    await dbCleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  };

  return { tempDir, portalPath, config, db, cleanup };
}

/**
 * Helper to create ICliApplicationContext from test env
 */
function createTestContext(config: any, db: any): ICliApplicationContext {
  const stubConfig = createStubConfig(config);
  return {
    config: stubConfig,
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(),
    toolRegistry: new ToolRegistry({ config, db }),
  };
}

/**
 * Initialize MCP server test environment with portal
 */
export async function initMCPTest(
  options: IPortalTestOptions = {},
): Promise<IMCPTestContext> {
  const env = await initTestEnv(options);
  const context = createTestContext(env.config, env.db);
  const server = new MCPServer({ context, transport: McpTransportType.STDIO });
  await server.start();

  const cleanup = async () => {
    await server.stop();
    await env.cleanup();
  };

  return {
    tempDir: env.tempDir,
    portalPath: env.portalPath,
    server,
    db: env.db,
    cleanup,
  };
}

// ... initMCPTestWithoutPortal ...

// ...

export async function initToolPermissionTest(
  options: IToolPermissionOptions = {},
): Promise<IToolPermissionTestContext> {
  const {
    portalAlias = "TestPortal",
    operations = [PortalOperation.READ],
    identityId = "test-agent",
    fileContent = {},
    initGit = false,
  } = options;

  const env = await initTestEnv({
    portalAlias,
    fileContent,
    initGit,
    permissions: {
      identities_allowed: [identityId],
      operations,
    },
    prefix: "mcp-perm-test-",
  });

  const permissions: IPortalPermissions = {
    alias: portalAlias,
    target_path: env.portalPath,
    identities_allowed: [identityId],
    operations,
  };

  return {
    tempDir: env.tempDir,
    portalPath: env.portalPath,
    config: env.config,
    db: env.db,
    permissions,
    cleanup: env.cleanup,
  };
}

/**
 * Initialize MCP server without any portals (for testing portal errors)
 */
export async function initMCPTestWithoutPortal(): Promise<
  Omit<IMCPTestContext, "portalPath">
> {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-test-" });
  const { db, cleanup: dbCleanup } = await initTestDbService();

  const config = createMockConfig(tempDir);
  const context = createTestContext(config, db);
  const server = new MCPServer({ context, transport: McpTransportType.STDIO });
  await server.start();

  const cleanup = async () => {
    await server.stop();
    await dbCleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  };

  return { tempDir, server, db, cleanup };
}

/**
 * Alias for initMCPTestWithoutPortal to maintain compatibility
 */
export const initSimpleMCPServer = initMCPTestWithoutPortal;

/**
 * Create MCP tool call request
 *
 * @example
 * const request = createToolCallRequest(McpToolName.READ_FILE, {
 *   portal: "TestPortal",
 *   path: "test.txt"
 * });
 */
export function createToolCallRequest(
  toolName: string,
  args: Record<string, JSONValue>,
  id: number | string = 1,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };
}

/**
 * Create MCP request for any method
 *
 * @example
 * const request = createMCPRequest("initialize", {
 *   protocolVersion: "2024-11-05",
 *   clientInfo: { name: "test", version: "1.0.0" }
 * });
 */
export function createMCPRequest(
  method: string,
  params?: Record<string, JSONValue>,
  id: number | string = 1,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method,
    params: params || {},
  };
}

/**
 * Assert MCP error response with specific code
 *
 * @throws AssertionError if response is not an error or code doesn't match
 */
export function assertMCPError(
  response: any,
  expectedCode: number,
  messageContains?: string,
): void {
  assertExists(response.error, "Expected error in response");
  assertEquals(
    response.error.code,
    expectedCode,
    `Expected error code ${expectedCode}, got ${response.error.code}: ${response.error.message}`,
  );

  if (messageContains) {
    const message = response.error.message as string;
    if (!message.includes(messageContains)) {
      throw new Error(
        `Expected error message to contain "${messageContains}", got: "${message}"`,
      );
    }
  }
}

/**
 * Assert MCP success response and return result
 *
 * @throws AssertionError if response contains an error
 * @returns The result object from the response
 */
export function assertMCPSuccess<T = any>(response: any): T {
  if (response.error) {
    throw new Error(
      `Expected success, got error ${response.error.code}: ${response.error.message}`,
    );
  }

  assertExists(response.result, "Expected result in response");
  return response.result as T;
}

/**
 * Assert that response result has content array with text
 */
export function assertMCPContentIncludes(response: any, text: string): void {
  const result = assertMCPSuccess(response);
  assertExists(result.content, "Expected content array in result");

  const content = result.content as Array<{ type: string; text: string }>;
  const hasText = content.some((item) => item.text?.includes(text));

  if (!hasText) {
    throw new Error(
      `Expected content to include "${text}", got: ${JSON.stringify(content)}`,
    );
  }
}

/**
 * Create a test portal with git initialization
 * @deprecated Use setupGitRepo instead
 */
export async function createGitPortal(
  tempDir: string,
  portalName: string = "TestPortal",
): Promise<string> {
  const portalPath = join(tempDir, portalName);
  await ensureDir(portalPath);
  await setupGitRepo(portalPath);
  return portalPath;
}
