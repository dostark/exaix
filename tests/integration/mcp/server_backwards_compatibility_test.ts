/**
 * @module ServerBackwardsCompatibilityTest
 * @path tests/integration/mcp/server_backwards_compatibility_test.ts
 * @description Regression tests verifying that all canonical McpToolName enum values
 * remain callable via buildHandlers(). Guards against accidental renames or removals
 * during Phase 77/76 migration work. Fails if any live tool name is dropped from the
 * handler assembly without an explicit deprecation plan.
 */

import { assert, assertEquals } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { buildHandlers } from "@exaix-team/mcp-server";
import { createStubContext } from "@exaix/testing";

const context = createStubContext();
const permissions = new AllowAllPermissionsService();

// Name-preservation regression tests

Deno.test("backwards_compat: all McpToolName enum values are registered in buildHandlers()", () => {
  const handlers = buildHandlers(context, permissions);
  const allNames = Object.values(McpToolName) as string[];

  const missing = allNames.filter((name) => !handlers.has(name as McpToolName));
  assertEquals(
    missing,
    [],
    `The following McpToolName values have no registered handler: [${missing.join(", ")}]. ` +
      `Removing or renaming a tool name requires an explicit deprecation plan.`,
  );
});

Deno.test("backwards_compat: read_file handler responds to McpToolName.READ_FILE", () => {
  const handlers = buildHandlers(context, permissions);
  assert(handlers.has(McpToolName.READ_FILE), "McpToolName.READ_FILE must be registered");
  const def = handlers.get(McpToolName.READ_FILE)!.getToolDefinition();
  assertEquals(def.name, McpToolName.READ_FILE);
});

Deno.test("backwards_compat: write_file handler responds to McpToolName.WRITE_FILE", () => {
  const handlers = buildHandlers(context, permissions);
  assert(handlers.has(McpToolName.WRITE_FILE), "McpToolName.WRITE_FILE must be registered");
  const def = handlers.get(McpToolName.WRITE_FILE)!.getToolDefinition();
  assertEquals(def.name, McpToolName.WRITE_FILE);
});

Deno.test("backwards_compat: domain tool handlers use their canonical exaix_ prefixed names", () => {
  const handlers = buildHandlers(context, permissions);

  assertEquals(
    handlers.get(McpToolName.CREATE_REQUEST)!.getToolDefinition().name,
    "exaix_create_request",
  );
  assertEquals(
    handlers.get(McpToolName.LIST_PLANS)!.getToolDefinition().name,
    "exaix_list_plans",
  );
  assertEquals(
    handlers.get(McpToolName.APPROVE_PLAN)!.getToolDefinition().name,
    "exaix_approve_plan",
  );
  assertEquals(
    handlers.get(McpToolName.QUERY_JOURNAL)!.getToolDefinition().name,
    "exaix_query_journal",
  );
});

Deno.test("backwards_compat: handler count equals McpToolName enum value count", () => {
  const handlers = buildHandlers(context, permissions);
  const allNames = Object.values(McpToolName);
  assertEquals(
    handlers.size,
    allNames.length,
    `buildHandlers() has ${handlers.size} handlers but McpToolName has ${allNames.length} values`,
  );
});
