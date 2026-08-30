/**
 * @module McpServerApp
 * @path apps/mcp-server/main.ts
 * @description Standalone MCP server entry point. Wires minimal services and starts
 * the MCP server over stdio or SSE transport.
 * @architectural-layer Application
 * @related-files ["packages-team/mcp-server/server.ts", "apps/exactl/src/commands/mcp_commands.ts"]
 */

import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ToolRegistry } from "@exaix/tool-runtime";
import type { IDatabaseService } from "@exaix/core/types";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { IModelProvider } from "@exaix/ai";
import type { IGitService } from "@exaix/core/types";
import type { IGitServiceFactory } from "@exaix/core/types";
import type { IDisplayService } from "@exaix/core/types";
import { buildMcpServer, MCPServer } from "@exaix-team/mcp-server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GitService } from "@exaix/git";
import { DEFAULT_MCP_HTTP_PORT, McpTransportType } from "@exaix/mcp";
import { validateMCPToolResponse, validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";

function createProviderStub(): IModelProvider {
  return {
    id: "mcp-server",
    generate: () =>
      Promise.resolve({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub",
        provider: "mcp-server",
      }),
  };
}

function createGitServiceFactory(
  config: ReturnType<ConfigService["get"]>,
): IGitServiceFactory {
  return {
    createGitService(repoPath: string, traceId: string): IGitService {
      return new GitService({ config, repoPath, traceId });
    },
  };
}

function createGitServiceStub(): IGitService {
  return {
    setRepository: () => {},
    getRepository: () => "",
    ensureRepository: () => Promise.resolve(),
    ensureIdentity: () => Promise.resolve(),
    createBranch: () => Promise.resolve(""),
    commit: () => Promise.resolve(""),
    checkoutBranch: () => Promise.resolve(),
    getCurrentBranch: () => Promise.resolve("main"),
    getDefaultBranch: () => Promise.resolve("main"),
    addWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    pruneWorktrees: () => Promise.resolve(""),
    listWorktrees: () => Promise.resolve([]),
    runGitCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
    validateArgs: () => ({ valid: true }),
  };
}

function createDisplayServiceStub(): IDisplayService {
  return {
    info: async () => {},
    warn: async () => {},
    error: async () => {},
    debug: async () => {},
    fatal: async () => {},
  };
}

/**
 * Provider, git, and display services are stubs by design — this server exercises
 * transport, discovery, permissions, and filesystem tools, not LLM or git behaviour.
 * ToolRegistry is NOT optional: SearchFilesTool/RunCommandTool fail without it.
 */
export function buildServerContext(
  configService: ConfigService,
): { context: ICliApplicationContext; dispose: () => void } {
  const config = configService.get();
  const dbService: IDatabaseService = new DatabaseService(config);

  // When EXA_MCP_REAL_GIT is not set (CI, test environments), use the stub.
  // Scenario configs set EXA_MCP_REAL_GIT=1 to exercise real git behaviour.
  const useRealGit = Deno.env.get("EXA_MCP_REAL_GIT") === "1";
  const gitServiceFactory: IGitServiceFactory = useRealGit ? createGitServiceFactory(config) : {
    createGitService: (_repoPath: string, _traceId: string) => createGitServiceStub(),
  };
  const gitService = useRealGit
    ? gitServiceFactory.createGitService(config.system.root, "mcp-server-boot")
    : createGitServiceStub();

  const context: ICliApplicationContext = {
    config: configService,
    db: dbService,
    provider: createProviderStub(),
    git: gitService,
    gitServiceFactory,
    display: createDisplayServiceStub(),
  };

  // Constructed after `context` so the registry sees the same services the handlers do,
  // then attached back onto it — the dependency is genuinely mutual.
  context.toolRegistry = new ToolRegistry({ config, context });

  return {
    context,
    dispose: () => {
      try {
        dbService.close?.();
      } catch { /* best-effort teardown */ }
    },
  };
}

function parseFlags(): { transport: McpTransportType; port: number } {
  const transportIndex = Deno.args.indexOf("--transport");
  const transportValue = transportIndex >= 0 && transportIndex + 1 < Deno.args.length
    ? Deno.args[transportIndex + 1]
    : "stdio";

  const portIndex = Deno.args.indexOf("--port");
  const port = portIndex >= 0 && portIndex + 1 < Deno.args.length
    ? parseInt(Deno.args[portIndex + 1], 10)
    : DEFAULT_MCP_HTTP_PORT;

  return {
    transport: transportValue === "sse" ? McpTransportType.SSE : McpTransportType.STDIO,
    port,
  };
}

if (import.meta.main) {
  const { transport, port } = parseFlags();

  const configPath = Deno.env.get("EXA_CONFIG_PATH");
  const configService = new ConfigService(configPath);
  const { context } = buildServerContext(configService);

  const mcpServerOptions = {
    context,
    transport,
    resultValidator: {
      validateEnvelope: validateToolResultEnvelope,
      validateMCPResponse: validateMCPToolResponse,
    },
  };

  if (transport === McpTransportType.SSE) {
    const server = new MCPServer(mcpServerOptions);
    await server.startHTTPServer(port);
  } else {
    // stdio uses the official SDK's serveStdio + McpServer with legacy: "serve" (the SDK
    // default) — Exaix's stdio consumers are freshly spawned per connection via `exactl
    // mcp start`, matching pre-migration hand-wired behavior (see server.ts's buildSdkServer).
    serveStdio(() => buildMcpServer(mcpServerOptions), { legacy: "serve" });
  }
}
