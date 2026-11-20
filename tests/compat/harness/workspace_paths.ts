/**
 * @module CompatWorkspacePaths
 * @path tests/compat/harness/workspace_paths.ts
 * @description Builds a PathResolver for a host workspace copy so that every harness path is validated.
 */

import { createPathResolver } from "@exaix/portal";
import type { PathResolver } from "@exaix/portal";
import { ConfigSchema } from "@exaix/schemas";
import { isAbsolute, join, resolve } from "@std/path";
import { parse } from "@std/toml";
import { SANDBOX_COPY_ROOT } from "./sandbox.ts";

export const WORKSPACE_CONFIG_FILE = "exa.config.toml";

/** Maps a path that is valid inside the sandbox to the same place in the host copy. */
export function mapToCopy(path: string, copyDir: string): string {
  const root = resolve(copyDir);
  if (path === SANDBOX_COPY_ROOT) return root;
  if (path.startsWith(`${SANDBOX_COPY_ROOT}/`)) return join(root, path.slice(SANDBOX_COPY_ROOT.length + 1));
  return isAbsolute(path) ? path : resolve(root, path);
}

/** Points `system.root` and every portal target at the copy, in memory only. The file is not changed and no journal row is written. */
export async function createCopyResolver(copyDir: string): Promise<PathResolver> {
  const root = resolve(copyDir);
  const config = ConfigSchema.parse(parse(await Deno.readTextFile(join(root, WORKSPACE_CONFIG_FILE))));
  return createPathResolver({
    ...config,
    system: { ...config.system, root },
    portals: config.portals.map((portal) => ({ ...portal, target_path: mapToCopy(portal.target_path, root) })),
  });
}
