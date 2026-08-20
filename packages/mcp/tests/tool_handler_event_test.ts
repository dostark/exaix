/**
 * @module ToolHandlerEventTest
 * @path packages/mcp/tests/tool_handler_event_test.ts
 * @description Verifies ToolHandler.formatSuccess (via the protected logToolExecution
 * helper) emits mcp.tool.executed with a real, field-level payload through a real
 * EventLogger/db, using a minimal concrete subclass — the same pattern already used by
 * ProbeToolHandler (tool_handler_git_test.ts) and StubReadHandler
 * (flow_runner_confirmation_wiring_test.ts) — deterministic, no daemon, no live
 * provider (Phase 169 Step 3 / pre-gap-analysis GAP-2).
 * @architectural-layer MCP
 * @related-files ["packages/mcp/server/tool_handler.ts"]
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { createStubContext, initTestDbService } from "@exaix/testing";
import { ToolHandler } from "@exaix/mcp/server";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { JSONValue, LogMetadata } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";

/** Minimal concrete ToolHandler exposing formatSuccess for probing (mirrors ProbeToolHandler). */
class ProbeToolHandler extends ToolHandler {
  callFormatSuccess(
    toolName: string,
    portal: string,
    identityId: string,
    metadata: LogMetadata,
  ): MCPToolResponse {
    return this.formatSuccess(toolName, portal, identityId, [], metadata);
  }

  execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    return Promise.resolve({ content: [] });
  }

  getToolDefinition() {
    return { name: "probe", description: "probe handler", inputSchema: {} };
  }
}

Deno.test("[ToolHandler] formatSuccess emits mcp.tool.executed with a real, field-level payload", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const context = createStubContext({ db }) as ICliApplicationContext;
    const handler = new ProbeToolHandler(context, undefined, logger);

    handler.callFormatSuccess("read_file", "my-portal", "test-agent", { path: "src/index.ts" });
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.McpToolExecuted) as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "mcp.tool.executed must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.path, "src/index.ts");
    assertEquals(payload.portal, "my-portal");
    assertEquals(payload.success, true);
  } finally {
    await cleanup();
  }
});
