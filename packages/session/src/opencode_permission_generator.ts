/**
 * @module OpencodePermissionGenerator
 * @path packages/session/src/opencode_permission_generator.ts
 * @description Phase 128 Step 2 — builds the OpenCode opencode.jsonc permission
 *   config from a brief's permitted_paths. Pure builder + async disk writer.
 *   The agent key uses DOGFOOD_CODER_IDENTITY_ID from @exaix/core/types.
 * @architectural-layer Services
 * @related-files [packages/schemas/src/opencode_config.ts, packages/session/src/scope_checker.ts, packages/session/src/mod.ts]
 */

import { dirname } from "@std/path";
import { DOGFOOD_CODER_IDENTITY_ID } from "@exaix/core/types";
import { OpencodeConfigSchema } from "@exaix/schemas/opencode_config.ts";
import type { OpencodeConfig } from "@exaix/schemas/opencode_config.ts";
import type { PathResolver } from "@exaix/portal";
import type { OpencodePermissionValue } from "@exaix/schemas/opencode_config.ts";
import { checkScope } from "./scope_checker.ts";

export interface IOpencodePermissionConfig {
  config: OpencodeConfig;
  configPath: string;
}

export function buildOpencodePermissionConfig(
  permittedPaths: string[],
  worktreeRoot?: string,
): OpencodeConfig {
  if (worktreeRoot) {
    for (const p of permittedPaths) {
      const result = checkScope([p], [p], worktreeRoot);
      if (result.violations.length > 0) {
        throw new Error(
          `Permitted path "${p}" escapes worktree root "${worktreeRoot}"`,
        );
      }
    }
  }

  const editPermissions: Record<string, OpencodePermissionValue> = { "*": "deny" };
  for (const p of permittedPaths) {
    editPermissions[p] = "allow";
  }

  return {
    agent: {
      [DOGFOOD_CODER_IDENTITY_ID]: {
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
): Promise<IOpencodePermissionConfig> {
  const config = buildOpencodePermissionConfig(permittedPaths, worktreeRoot);

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

  return { config, configPath: resolvedPath };
}
