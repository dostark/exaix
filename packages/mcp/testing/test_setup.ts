// deno-lint-ignore-file no-explicit-any
/**
 * @module McpTestSetup
 * @path packages/mcp/testing/test_setup.ts
 * @related-files []
 * @architectural-layer MCP
 * @ungrounded
 * @description Provides common setup routines for MCP server tests, coordinating
 * transport layer (SSE/Stdio) initialization and session creation.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { GitService } from "@exaix/git";
import {
  GIT_CMD_ADD,
  GIT_CMD_BRANCH,
  GIT_CMD_CHECKOUT,
  GIT_CMD_COMMIT,
  GIT_CMD_INIT,
  GIT_CMD_LIST,
  GIT_CMD_LOG,
  GIT_CMD_REMOVE,
  GIT_CMD_REV_LIST,
  GIT_CMD_REV_PARSE,
  GIT_CMD_STATUS,
  GIT_CMD_WORKTREE,
} from "@exaix/git/constants.ts";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";

import { McpTransportType } from "@exaix/mcp";
import { PortalOperation } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { MCPServer } from "@exaix-team/mcp-server";
import { PortalPermissionsService } from "@exaix/portal";
import { ToolRegistry } from "@exaix/tool-runtime";
import {
  createMockConfig,
  createStubConfig,
  createStubContext,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  initTestDbService,
} from "@exaix/testing";

import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import type { JSONValue } from "@exaix/core/types";
import type { IApplicationContext } from "@exaix/core/types";
import type { IGitService, IGitServiceFactory } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
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
    // When the test creates a real git repo, enable real GitService so
    // handlers route through actual git commands (not the stub). This
    // makes format-variant tests (status --short, commit --signoff,
    // worktree add/list, etc.) exercise real git behaviour.
    Deno.env.set("EXA_MCP_REAL_GIT", "1");
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
 * Git service factory for test contexts. Returns real GitService instances when
 * EXA_MCP_REAL_GIT=1 (set by initGit tests) so format-variant tests exercise
 * real git behaviour; otherwise a stub emulating common git subcommands.
 */
function createGitServiceFactory(config: Config): IGitServiceFactory {
  const stubGit = createStubGit();
  const useRealGit = Deno.env.get("EXA_MCP_REAL_GIT") === "1";
  return {
    createGitService: (_repoPath: string, _traceId: string): IGitService => {
      if (useRealGit) {
        return new GitService({ config, repoPath: _repoPath });
      }
      return {
        ...stubGit,
        runGitCommand: (args: string[]): Promise<{ output: string; exitCode: number }> => {
          if (args.includes(GIT_CMD_STATUS)) {
            if (args.includes("--short")) return Promise.resolve({ output: " M new-file.txt", exitCode: 0 });
            if (args.includes("--porcelain")) return Promise.resolve({ output: "", exitCode: 0 });
            return Promise.resolve({ output: "On branch main\nnothing to commit, working tree clean", exitCode: 0 });
          }
          if (args.includes(GIT_CMD_LOG)) {
            return Promise.resolve({
              output: "abc123 feat: add file\nSigned-off-by: Tester <test@test.com>",
              exitCode: 0,
            });
          }
          if (args.includes(GIT_CMD_REV_PARSE) && args.includes("HEAD")) {
            return Promise.resolve({ output: "abc123def456789012345678901234567890abcd\n", exitCode: 0 });
          }
          if (args[0] === GIT_CMD_ADD) return Promise.resolve({ output: "", exitCode: 0 });
          if (args[0] === GIT_CMD_COMMIT) return Promise.resolve({ output: "", exitCode: 0 });
          if (args[0] === GIT_CMD_CHECKOUT || args[0] === GIT_CMD_BRANCH || args.includes(GIT_CMD_CHECKOUT)) {
            return Promise.resolve({ output: "Switched to a new branch 'feat/test'\n", exitCode: 0 });
          }
          if (args.includes(GIT_CMD_WORKTREE)) {
            if (args[1] === GIT_CMD_ADD) {
              return Promise.resolve({
                output: "Preparing worktree (new branch 'feat/wt-test')\nHEAD is now at abc123 init",
                exitCode: 0,
              });
            }
            if (args[1] === GIT_CMD_LIST) {
              return Promise.resolve({
                output: "/tmp/repo       abc123 [main]\n/tmp/repo/wt    abc123 [feat/wt-test]",
                exitCode: 0,
              });
            }
            if (args[1] === GIT_CMD_REMOVE) return Promise.resolve({ output: "", exitCode: 0 });
            return Promise.resolve({ output: "", exitCode: 0 });
          }
          if (args.includes(GIT_CMD_REV_LIST) && args.includes("--count")) {
            return Promise.resolve({ output: "1", exitCode: 0 });
          }
          if (args.includes(GIT_CMD_INIT)) {
            return Promise.resolve({ output: "Initialized empty Git repository", exitCode: 0 });
          }
          if (args[0] === "config") return Promise.resolve({ output: "", exitCode: 0 });
          return Promise.resolve({ output: "", exitCode: 0 });
        },
      };
    },
  };
}

/**
 * Helper to create IApplicationContext from test env
 */
function createTestContext(
  config: Config,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
): IApplicationContext {
  const stubConfig = createStubConfig(config);
  const stubGit = createStubGit();
  const stubFactory = createGitServiceFactory(config);
  return {
    config: stubConfig,
    db,
    git: stubGit,
    gitServiceFactory: stubFactory,
    provider: createStubProvider(),
    display: createStubDisplay(),
    toolRegistry: new ToolRegistry({ config }),
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
  const logger = new EventLogger({ db: env.db });
  const server = new MCPServer({
    context,
    logger,
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
  overrides: Partial<IApplicationContext> = {},
): IApplicationContext {
  return createStubContext({
    config: createStubConfig(env.config),
    gitServiceFactory: createGitServiceFactory(env.config),
    ...overrides,
  });
}

export function createBaseToolContext(
  overrides: Partial<IApplicationContext> = {},
): IApplicationContext {
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
  const logger = new EventLogger({ db });
  const server = new MCPServer({
    context,
    logger,
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
 */
export function createMCPRequest(
  method: string,
  params?: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
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
 */
export function assertMCPError(
  response: IMCPResponseShape,
  expectedCode: number,
  messageContains?: Opt<string, Reason.OptionalInput>,
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
 */
export function assertMCPToolError(
  response: IMCPResponseShape,
  messageContains?: Opt<string, Reason.OptionalInput>,
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
 */
export function getFirstStructuredDataContent<TData extends JSONValue>(response: MCPToolResponse): TData {
  const item = response.content.find((contentItem) => contentItem.type === "exaix_structured_data");
  if (!item || item.type !== "exaix_structured_data") {
    throw new Error("Expected an exaix_structured_data content block in MCPToolResponse");
  }
  return item.data as TData;
}
