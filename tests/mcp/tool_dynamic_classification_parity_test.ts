/**
 * @module ToolDynamicClassificationParityTest
 * @path tests/mcp/tool_dynamic_classification_parity_test.ts
 * @description Parity tests verifying that buildDynamicHandlers() output, DYNAMIC_MODE_TOOLS,
 * and manifest dynamic_mode_allowed entries all agree. Prevents the three sources from
 * drifting when new tools are added or classifications change.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { DYNAMIC_MODE_TOOLS, TOOL_MANIFEST } from "@exaix/mcp";
import { ToolKind } from "@exaix/core";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { buildDynamicHandlers, buildHandlers } from "../../src/mcp/tools.ts";
import { createStubContext } from "../helpers/test_helpers.ts";

const context = createStubContext();
const permissions = new AllowAllPermissionsService();

/** Names from manifest where dynamic allowed and approval not required */
function manifestDynamicToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed && !e.requires_human_approval)
    .map((e) => e.name)
    .sort();
}

// ── Three-way parity tests ────────────────────────────────────────────────────

Deno.test("dynamic_parity: buildDynamicHandlers() keys match DYNAMIC_MODE_TOOLS", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);
  const handlerNames = [...dynamicHandlers.keys()].sort();
  const dynamicModeNames = [...DYNAMIC_MODE_TOOLS].sort();

  assertEquals(
    handlerNames,
    dynamicModeNames,
    `buildDynamicHandlers() keys and DYNAMIC_MODE_TOOLS must match exactly. ` +
      `Handlers: [${handlerNames.join(", ")}], DYNAMIC_MODE_TOOLS: [${dynamicModeNames.join(", ")}]`,
  );
});

Deno.test("dynamic_parity: DYNAMIC_MODE_TOOLS matches manifest dynamic_mode_allowed entries", () => {
  const manifestDynamic = manifestDynamicToolNames();
  const dynamicModeNames = [...DYNAMIC_MODE_TOOLS].sort();

  assertEquals(
    dynamicModeNames,
    manifestDynamic,
    `DYNAMIC_MODE_TOOLS must exactly match manifest entries where ` +
      `dynamic_mode_allowed && !requires_human_approval`,
  );
});

Deno.test("dynamic_parity: buildDynamicHandlers() is a strict subset of buildHandlers()", () => {
  const allHandlers = buildHandlers(context, permissions);
  const dynamicHandlers = buildDynamicHandlers(context, permissions);

  for (const name of dynamicHandlers.keys()) {
    assert(
      allHandlers.has(name),
      `Dynamic handler '${name}' must also be present in buildHandlers() output`,
    );
  }

  assert(
    dynamicHandlers.size <= allHandlers.size,
    "buildDynamicHandlers() must be a subset of buildHandlers()",
  );
});

Deno.test("dynamic_parity: tools with requires_human_approval are not in buildDynamicHandlers()", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);
  const approvalTools = TOOL_MANIFEST
    .filter((e) => e.requires_human_approval)
    .map((e) => e.name);

  for (const name of approvalTools) {
    assertFalse(
      dynamicHandlers.has(name as Parameters<typeof dynamicHandlers.has>[0]),
      `Tool '${name}' has requires_human_approval but appears in buildDynamicHandlers()`,
    );
  }
});

Deno.test("dynamic_parity: all MCP_DOMAIN tools with dynamic_mode_allowed appear in buildDynamicHandlers()", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);
  const domainDynamicTools = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_DOMAIN && e.dynamic_mode_allowed && !e.requires_human_approval,
  );

  assert(domainDynamicTools.length > 0, "manifest must have at least one dynamic domain tool");

  for (const tool of domainDynamicTools) {
    assert(
      dynamicHandlers.has(tool.name as Parameters<typeof dynamicHandlers.has>[0]),
      `Domain tool '${tool.name}' is dynamic_mode_allowed but missing from buildDynamicHandlers()`,
    );
  }
});
