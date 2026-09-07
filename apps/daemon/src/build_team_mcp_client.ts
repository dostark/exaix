/**
 * @module BuildTeamMcpClient
 * @path apps/daemon/src/build_team_mcp_client.ts
 * @description Phase 163 Step 10 — builds the Team-edition dynamic-step tool dispatcher
 * (`LocalToolDispatcher` from `buildDynamicHandlers`) with the guardrail fail-soft
 * convention: a wiring failure (dynamic import, handler construction, or dispatcher
 * construction) logs `DynamicToolsInitFailed` and returns `undefined`, degrading to
 * today's no-dynamic-step-mode behavior rather than crashing Team-daemon boot.
 * @architectural-layer Application
 * @related-files [apps/daemon/main.ts, exaix-team/packages/mcp-server/tools.ts, packages/mcp/server/local_tool_dispatcher.ts]
 */

import { LocalToolDispatcher } from "@exaix/mcp/server";
import { DomainEventType } from "@exaix/core/events";
import type { IApplicationContext } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";

/** Fail-soft: returns `undefined` and logs `DynamicToolsInitFailed` on any wiring error. */
export async function buildTeamMcpClient(
  context: IApplicationContext,
  portalPermissions: IPortalPermissionsChecker,
  logger: IEventLogger,
): Promise<LocalToolDispatcher | undefined> {
  try {
    const { buildDynamicHandlers } = await import("@exaix-team/mcp-server");
    return new LocalToolDispatcher(context, buildDynamicHandlers(context, portalPermissions));
  } catch (error) {
    logger.error(DomainEventType.DynamicToolsInitFailed, "daemon", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
