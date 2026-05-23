/**
 * @module ToolDynamicClassificationParityTest
 * @path packages/mcp/tests/tool_dynamic_classification_parity_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Parity tests verifying that buildDynamicHandlers() output, DYNAMIC_MODE_TOOLS,
 * DYNAMIC_MODE_APPROVAL_TOOLS, and manifest dynamic_mode_allowed entries all agree. Prevents
 * the three sources from drifting when new tools are added or classifications change.
 *
 * Phase 79 note: tools with requires_human_approval: true AND dynamic_mode_allowed: true are
 * NOW included in buildDynamicHandlers() (gated at runtime by IToolConfirmationInterceptor).
 * They appear in DYNAMIC_MODE_APPROVAL_TOOLS, not in DYNAMIC_MODE_TOOLS.
 */

import { assert, assertEquals } from "@std/assert";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, TOOL_MANIFEST } from "@exaix/mcp";
import { McpToolName, ToolKind } from "@exaix/core";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { buildDynamicHandlers, buildHandlers } from "@exaix/mcp/server";
import { createStubContext } from "@exaix/testing";

const context = createStubContext();
const permissions = new AllowAllPermissionsService();

/** Names from manifest where dynamic allowed and approval not required */
function manifestSafeToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed && !e.requires_human_approval)
    .map((e) => e.name)
    .sort();
}

/** Names from manifest where dynamic allowed AND approval required */
function manifestApprovalToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed && e.requires_human_approval)
    .map((e) => e.name)
    .sort();
}

/** All dynamic-allowed tool names from manifest (safe + approval-required) */
function manifestAllDynamicToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed)
    .map((e) => e.name)
    .sort();
}

// ── DYNAMIC_MODE_TOOLS parity ─────────────────────────────────────────────────

Deno.test("dynamic_parity: DYNAMIC_MODE_TOOLS matches manifest entries where dynamic_allowed && !requires_approval", () => {
  const manifestSafe = manifestSafeToolNames();
  const dynamicModeNames = [...DYNAMIC_MODE_TOOLS].sort();

  assertEquals(
    dynamicModeNames,
    manifestSafe,
    `DYNAMIC_MODE_TOOLS must exactly match manifest entries where ` +
      `dynamic_mode_allowed && !requires_human_approval`,
  );
});

// ── DYNAMIC_MODE_APPROVAL_TOOLS parity ───────────────────────────────────────

Deno.test("dynamic_parity: DYNAMIC_MODE_APPROVAL_TOOLS matches manifest entries where dynamic_allowed && requires_approval", () => {
  const manifestApproval = manifestApprovalToolNames();
  const approvalNames = [...DYNAMIC_MODE_APPROVAL_TOOLS].sort();

  assertEquals(
    approvalNames,
    manifestApproval,
    `DYNAMIC_MODE_APPROVAL_TOOLS must exactly match manifest entries where ` +
      `dynamic_mode_allowed && requires_human_approval`,
  );
});

Deno.test("dynamic_parity: DYNAMIC_MODE_APPROVAL_TOOLS includes exaix_create_request and exaix_approve_plan", () => {
  assert(
    DYNAMIC_MODE_APPROVAL_TOOLS.has(McpToolName.CREATE_REQUEST),
    "exaix_create_request must be in DYNAMIC_MODE_APPROVAL_TOOLS (Phase 79)",
  );
  assert(
    DYNAMIC_MODE_APPROVAL_TOOLS.has(McpToolName.APPROVE_PLAN),
    "exaix_approve_plan must be in DYNAMIC_MODE_APPROVAL_TOOLS (Phase 79)",
  );
});

Deno.test("dynamic_parity: DYNAMIC_MODE_TOOLS and DYNAMIC_MODE_APPROVAL_TOOLS are disjoint", () => {
  for (const name of DYNAMIC_MODE_APPROVAL_TOOLS) {
    assert(
      !DYNAMIC_MODE_TOOLS.has(name),
      `Tool '${name}' appears in both DYNAMIC_MODE_TOOLS and DYNAMIC_MODE_APPROVAL_TOOLS`,
    );
  }
});

// ── buildDynamicHandlers parity ───────────────────────────────────────────────

Deno.test("dynamic_parity: buildDynamicHandlers() keys match all manifest dynamic_mode_allowed entries", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);
  const handlerNames = [...dynamicHandlers.keys()].sort();
  const manifestAll = manifestAllDynamicToolNames();

  assertEquals(
    handlerNames,
    manifestAll,
    `buildDynamicHandlers() must include all manifest entries where dynamic_mode_allowed === true. ` +
      `Handlers: [${handlerNames.join(", ")}], Manifest: [${manifestAll.join(", ")}]`,
  );
});

Deno.test("dynamic_parity: buildDynamicHandlers() includes approval-required tools (Phase 79)", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);

  assert(
    dynamicHandlers.has(McpToolName.CREATE_REQUEST),
    "exaix_create_request must be in buildDynamicHandlers() after Phase 79 (gated by interceptor at runtime)",
  );
  assert(
    dynamicHandlers.has(McpToolName.APPROVE_PLAN),
    "exaix_approve_plan must be in buildDynamicHandlers() after Phase 79 (gated by interceptor at runtime)",
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

Deno.test("dynamic_parity: all MCP_DOMAIN tools with dynamic_mode_allowed appear in buildDynamicHandlers()", () => {
  const dynamicHandlers = buildDynamicHandlers(context, permissions);
  const domainDynamicTools = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_DOMAIN && e.dynamic_mode_allowed,
  );

  assert(domainDynamicTools.length > 0, "manifest must have at least one dynamic domain tool");

  for (const tool of domainDynamicTools) {
    assert(
      dynamicHandlers.has(tool.name as Parameters<typeof dynamicHandlers.has>[0]),
      `Domain tool '${tool.name}' is dynamic_mode_allowed but missing from buildDynamicHandlers()`,
    );
  }
});
