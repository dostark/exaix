/**
 * @module DogfoodMcpConfig
 * @path packages/session/src/dogfood_mcp_config.ts
 * @description Phase 176 Step 2 — pure builders (plus one disk writer) for per-launch
 * native MCP connection config, one shape per supported client: Claude Code (a
 * `--mcp-config <path> --strict-mcp-config` JSON file, `mcpServers.exaix_context` entry),
 * OpenCode (a `mcp.exaix_context` fragment merged into the existing permission config,
 * via generateOpencodePermissionConfig), and Codex (per-invocation `-c` overrides, no
 * file — governed session_delegate cycle only). The bearer credential's VALUE is never
 * written to any of these files or configs — only an env-var reference — so the actual
 * secret reaches the child exclusively through the launch's explicit env.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas, @exaix/portal]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/execution/src/strategies/cli_delegate_strategy.ts, packages/session/src/opencode_permission_generator.ts]
 */

import { dirname } from "@std/path";
import type { PathResolver } from "@exaix/portal";
import type { OpencodeMcp } from "@exaix/schemas/opencode_config.ts";
import type { IDogfoodContextConnection } from "@exaix/core/types";

/** Config-free connection facts a native launch needs — never the bearer VALUE itself
 *  except where a client's config format has no env-reference syntax (none of the three
 *  supported clients require that; all three reference the env var by name). */
export interface IDogfoodMcpConnectionInput {
  endpoint: string;
  bearerEnvVar: string;
  toolNames: readonly string[];
}

export interface IClaudeMcpHttpServerEntry {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

export interface IClaudeMcpConfigFile {
  mcpServers: Record<string, IClaudeMcpHttpServerEntry>;
}

/** Drops the bearer VALUE, keeping only what these builders ever need — an env-var
 *  reference, never the credential itself. */
export function toMcpConnectionInput(connection: IDogfoodContextConnection): IDogfoodMcpConnectionInput {
  return {
    endpoint: connection.endpoint,
    bearerEnvVar: connection.bearerEnvVar,
    toolNames: connection.tools.map((t) => t.name),
  };
}

/** The single MCP server key every generated native config registers this connection under. */
export const DOGFOOD_MCP_SERVER_KEY = "exaix_context";

// Claude Code — mcpServers HTTP entry, `${VAR}` env-reference header syntax.

export function buildClaudeMcpConfig(connection: IDogfoodMcpConnectionInput): IClaudeMcpConfigFile {
  return {
    mcpServers: {
      [DOGFOOD_MCP_SERVER_KEY]: {
        type: "http",
        url: connection.endpoint,
        headers: { Authorization: `Bearer \${${connection.bearerEnvVar}}` },
      },
    },
  };
}

/** `mcp__<server>__<tool>` — Claude Code's own naming convention for an MCP tool inside
 *  --allowedTools; merge into deriveClaudeToolFlags' extraAllowedTools, never a second flag. */
export function claudeMcpAllowedToolEntries(connection: IDogfoodMcpConnectionInput): string[] {
  return connection.toolNames.map((name) => `mcp__${DOGFOOD_MCP_SERVER_KEY}__${name}`);
}

export async function writeClaudeMcpConfig(
  connection: IDogfoodMcpConnectionInput,
  pathResolver: PathResolver,
  traceId: string,
): Promise<string> {
  const config = buildClaudeMcpConfig(connection);
  const resolvedPath = await pathResolver.resolve(`@Runtime/${traceId}/context-client/claude_mcp_config.json`);
  await Deno.mkdir(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${resolvedPath}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await Deno.rename(tmpPath, resolvedPath);
  return resolvedPath;
}

// OpenCode — `{env:VAR}` reference syntax; the caller merges this into
// generateOpencodePermissionConfig's existing agent.* config, never a standalone file.

export function buildOpencodeMcpFragment(connection: IDogfoodMcpConnectionInput): OpencodeMcp {
  return {
    [DOGFOOD_MCP_SERVER_KEY]: {
      type: "remote",
      url: connection.endpoint,
      oauth: false,
      headers: { Authorization: `Bearer {env:${connection.bearerEnvVar}}` },
    },
  };
}

// Codex — per-invocation -c overrides, no file. Governed cycle only; CliDelegateStrategy
// never spawns codex.

export function buildCodexMcpArgs(connection: IDogfoodMcpConnectionInput): string[] {
  const toolList = connection.toolNames.map((name) => `"${name}"`).join(",");
  return [
    "-c",
    `mcp_servers.${DOGFOOD_MCP_SERVER_KEY}.url="${connection.endpoint}"`,
    "-c",
    `mcp_servers.${DOGFOOD_MCP_SERVER_KEY}.bearer_token_env_var="${connection.bearerEnvVar}"`,
    "-c",
    `mcp_servers.${DOGFOOD_MCP_SERVER_KEY}.enabled_tools=[${toolList}]`,
  ];
}

// Startup cleanup — no per-launch config or credential survives a daemon restart.

/** Removes every `context-client/` dir under `@Runtime/<trace>/` at daemon startup so no
 *  orphaned native config (or stale credential reference) from a prior process survives. */
export async function removeOrphanContextClientConfigs(pathResolver: PathResolver): Promise<number> {
  const runtimeRoot = await pathResolver.resolve("@Runtime");
  let removed = 0;
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(runtimeRoot));
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const contextClientDir = `${runtimeRoot}/${entry.name}/context-client`;
    try {
      await Deno.remove(contextClientDir, { recursive: true });
      removed++;
    } catch {
      // No context-client dir for this trace — nothing to remove.
    }
  }
  return removed;
}
