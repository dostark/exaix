/**
 * @module RequestPaths
 * @path apps/exactl/src/handlers/request_paths.ts
 * @description Provides utility functions for resolving workspace request directories used by CLI handlers.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts]
 */

import { join } from "@std/path";
import type { ICommandContext } from "@exaix/cli/base.ts";

export function getWorkspaceRequestsDir(context: ICommandContext): string {
  const config = context.config.getAll();
  return join(
    config.system.root,
    config.paths.workspace,
    config.paths.requests,
  );
}

export function getWorkspaceArchiveDir(context: ICommandContext): string {
  const config = context.config.getAll();
  return join(
    config.system.root,
    config.paths.workspace,
    config.paths.archive,
  );
}

export function getWorkspaceRejectedDir(context: ICommandContext): string {
  const config = context.config.getAll();
  return join(
    config.system.root,
    config.paths.workspace,
    config.paths.rejected,
  );
}
