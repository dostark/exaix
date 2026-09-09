/**
 * @module OpencodePermissionGenerator
 * @path packages/session/src/opencode_permission_generator.ts
 * @description Phase 128 Step 2 — builds the OpenCode opencode.jsonc permission
 *   config from a brief's permitted_paths. Pure builder + async disk writer. The
 *   agent key is the caller's real delegating agent_role, not a hardcoded stand-in.
 * @architectural-layer Services
 * @related-files [packages/schemas/src/opencode_config.ts, packages/session/src/scope_checker.ts, packages/session/src/mod.ts]
 */

import { dirname } from "@std/path";
import { OpencodeConfigSchema } from "@exaix/schemas/opencode_config.ts";
import type { OpencodeConfig } from "@exaix/schemas/opencode_config.ts";
import type { PathResolver } from "@exaix/portal";
import type { OpencodePermissionValue } from "@exaix/schemas/opencode_config.ts";
import { checkScope } from "./scope_checker.ts";
import { buildOpencodeMcpFragment } from "./dogfood_mcp_config.ts";
import type { IDogfoodMcpConnectionInput } from "./dogfood_mcp_config.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IOpencodePermissionConfig {
  config: OpencodeConfig;
  configPath: string;
  /** The agent key used in the generated config. */
  agentKey: string;
}
/** Separate from the config builder so that stays a pure shape function; this runs the worktree guard at the production call-site. */
export function assertPathsWithinWorktree(permittedPaths: string[], worktreeRoot: string): void {
  for (const p of permittedPaths) {
    const result = checkScope([p], [p], worktreeRoot);
    if (result.violations.length > 0) {
      throw new Error(
        `Permitted path "${p}" escapes worktree root "${worktreeRoot}"`,
      );
    }
  }
}

export function buildOpencodePermissionConfig(
  permittedPaths: string[],
  agentRole: string,
): OpencodeConfig {
  const editPermissions: Record<string, OpencodePermissionValue> = { "*": "deny" };
  for (const p of permittedPaths) {
    editPermissions[p] = "allow";
  }

  return {
    agent: {
      [agentRole]: {
        edit: editPermissions,
        external_directory: { "**": "deny" },
        bash: { "*": "deny" },
      },
    },
  };
}

export async function generateOpencodePermissionConfig(
  permittedPaths: string[],
  worktreeRoot: string,
  pathResolver: PathResolver,
  traceId: string,
  agentRole: string,
  mcpConnection?: Opt<IDogfoodMcpConnectionInput, Reason.OptionalDependency>,
): Promise<IOpencodePermissionConfig> {
  assertPathsWithinWorktree(permittedPaths, worktreeRoot);
  const config = buildOpencodePermissionConfig(permittedPaths, agentRole);
  if (mcpConnection) {
    config.mcp = buildOpencodeMcpFragment(mcpConnection);
  }

  const parsed = OpencodeConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `OpenCode config validation failed: ${parsed.error.message}`,
    );
  }

  const aliasedPath = `@Runtime/${traceId}/opencode_config.json`;
  const resolvedPath = await pathResolver.resolve(aliasedPath);
  await Deno.mkdir(dirname(resolvedPath), { recursive: true });
  const tmpPath = `${resolvedPath}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(config, null, 2));
  await Deno.rename(tmpPath, resolvedPath);

  return { config, configPath: resolvedPath, agentKey: agentRole };
}
