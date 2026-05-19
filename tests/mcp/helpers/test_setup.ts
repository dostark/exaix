// deno-lint-ignore-file no-explicit-any
/**
 * @module MCPTestSetup
 * @path tests/mcp/helpers/test_setup.ts
 * @description Provides common setup routines for MCP server tests, coordinating
 * transport layer (SSE/Stdio) initialization and session creation.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";

import { McpTransportType } from "@exaix/mcp";
import { PortalOperation } from "@exaix/core";
import { MCPServer } from "../../../src/mcp/server.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { ToolRegistry } from "../../../src/services/tool/tool_registry.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import {
  createStubConfig,
  createStubContext,
  createStubDisplay,
  createStubGit,
  createStubProvider,
} from "../../helpers/test_helpers.ts";

import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import type { JSONValue } from "@exaix/core/types";
import type { ICliApplicationContext } from "../../../src/cli/cli_context.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";

interface IMCPErrorShape {
  code: number;
  message: string;
}

interface IMCPResponseShape<TResult = any> {
  error?: IMCPErrorShape;
  result?: TResult;
}

interface IMCPContentResult {
  content?: Array<{ type: string; text: string }>;
}

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
    default_branch: TEST_DEFAULT_BRANCH,
    identities_allowed: permissions.identities_allowed ?? ["*"],
    operations: (permissions.operations ?? []) as PortalOperation[],
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
function createTestContext(
  config: Config,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
): ICliApplicationContext {
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
  const server = new MCPServer({
    context,
    transport: McpTransportType.STDIO,
    permissions: new AllowAllPermissionsService(),
  });
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
    default_branch: TEST_DEFAULT_BRANCH,
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

export async function withToolPermissionTest(
  options: IToolPermissionOptions,
  run: (env: IToolPermissionTestContext) => Promise<void>,
): Promise<void> {
  const env = await initToolPermissionTest(options);

  try {
    await run(env);
  } finally {
    await env.cleanup();
  }
}

export function createToolContext(
  env: IToolPermissionTestContext,
  overrides: Partial<ICliApplicationContext> = {},
): ICliApplicationContext {
  return createStubContext({
    config: createStubConfig(env.config),
    ...overrides,
  });
}

export function createBaseToolContext(
  overrides: Partial<ICliApplicationContext> = {},
): ICliApplicationContext {
  return createStubContext(overrides);
}

export function createPermissionsService(env: IToolPermissionTestContext): PortalPermissionsService {
  return new PortalPermissionsService([env.permissions]);
}

export function assertToolDefinitionFields<TRequired>(
  def: { name: string; inputSchema: { required?: TRequired } },
  expectedName: string,
  requiredFields: string[],
): void {
  const required = Array.isArray(def.inputSchema.required)
    ? def.inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];

  assertEquals(def.name, expectedName);
  assertEquals(Array.isArray(def.inputSchema.required), true);

  for (const field of requiredFields) {
    assertStringIncludes(required.join(), field);
  }
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
  const server = new MCPServer({
    context,
    transport: McpTransportType.STDIO,
    permissions: new AllowAllPermissionsService(),
  });
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
): {
  jsonrpc: "2.0";
  id: number | string;
  method: "tools/call";
  params: { name: string; arguments: Record<string, JSONValue> };
} {
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
): {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, JSONValue>;
} {
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
  response: IMCPResponseShape,
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
 * Assert that a tools/call response contains an isError:true tool-logic error.
 * Use this instead of assertMCPError when the handler returns a structured
 * isError response rather than throwing a protocol exception.
 */
export function assertMCPToolError(
  response: IMCPResponseShape,
  messageContains?: string,
): void {
  assertExists(response.result, "Expected result in response (not a protocol error)");
  const result = response.result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  assertEquals(result.isError, true, "Expected isError:true in tool result");
  if (messageContains) {
    const text = result.content?.[0]?.text ?? "";
    assertStringIncludes(text, messageContains);
  }
}

/**
 * Assert MCP success response and return result
 *
 * @throws AssertionError if response contains an error
 * @returns The result object from the response
 */
export function assertMCPSuccess<T = any>(response: IMCPResponseShape<T>): T {
  if (response.error) {
    throw new Error(
      `Expected success, got error ${response.error.code}: ${response.error.message}`,
    );
  }

  assertExists(response.result, "Expected result in response");
  return response.result as T;
}

export function assertMCPContentIncludes(response: IMCPResponseShape<IMCPContentResult>, text: string): void {
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

/**
 * Extracts the text string from the first text-type content block in an MCPToolResponse.
 * Throws if the first content item is not a text block — use this where text content is expected.
 */
export function getFirstTextContent(response: MCPToolResponse): string {
  const item = response.content[0];
  if (item.type !== "text") {
    throw new Error(`Expected text content block at index 0, got type: ${item.type}`);
  }
  return item.text;
}

/**
 * Extracts the data payload from the first structured-data content block in an MCPToolResponse.
 * Throws if no structured content block is present.
 */
export function getFirstStructuredDataContent<TData extends JSONValue>(response: MCPToolResponse): TData {
  const item = response.content.find((contentItem) => contentItem.type === "exaix_structured_data");
  if (!item || item.type !== "exaix_structured_data") {
    throw new Error("Expected an exaix_structured_data content block in MCPToolResponse");
  }
  return item.data as TData;
}
