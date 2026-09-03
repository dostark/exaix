/**
 * @module RequestPaths
 * @path apps/exactl/src/handlers/request_paths.ts
 * @description Provides utility functions for resolving workspace request directories used by CLI handlers.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts]
 */

import { DEFAULT_AGENT_ROLE } from "@exaix/core";
import { RequestPriority } from "@exaix/core";
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

/** Core frontmatter fields shared across request list and show handlers. */
export const REQUEST_CORE_FIELDS: Array<{ key: string; fallback: string }> = [
  { key: "trace_id", fallback: "" },
  { key: "priority", fallback: RequestPriority.NORMAL },
  { key: "agent_role", fallback: DEFAULT_AGENT_ROLE },
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
