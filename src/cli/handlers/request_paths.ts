/**
 * @module RequestPaths
 * @path src/cli/handlers/request_paths.ts
 * @description Provides utility functions for resolving workspace request directories used by CLI handlers.
 * @architectural-layer CLI
 * * @related-files [src/cli/handlers/request_create_handler.ts]
 */

import { join } from "@std/path";
import type { ICommandContext } from "../base.ts";

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

/** Core frontmatter fields shared across request list and show handlers. */
export const REQUEST_CORE_FIELDS: Array<{ key: string; fallback: string }> = [
  { key: "trace_id", fallback: "" },
  { key: "priority", fallback: "normal" },
  { key: "identity", fallback: "default" },
  { key: "created", fallback: "" },
  { key: "created_by", fallback: "unknown" },
  { key: "source", fallback: "unknown" },
];

export function getWorkspaceRejectedDir(context: ICommandContext): string {
  const config = context.config.getAll();
  return join(
    config.system.root,
    config.paths.workspace,
    config.paths.rejected,
  );
}
