/**
 * @module ToolManifestSchemaRegistrationParityTest
 * @path packages/mcp/tests/tool_manifest_schema_registration_parity_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Parity tests verifying that every non-INTERNAL_ONLY tool in the canonical
 * manifest is registered by buildHandlers(), and every handler registered by buildHandlers()
 * has a corresponding manifest entry. Prevents tools from silently diverging between the
 * manifest (source of truth) and the live server handler assembly.
 */

import { assert, assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolKind } from "@exaix/core";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { buildHandlers } from "@exaix/mcp/server";
import { createStubContext } from "@exaix/testing";

const context = createStubContext();
const permissions = new AllowAllPermissionsService();

/** Names of all live tools in the manifest (non-INTERNAL_ONLY) */
function manifestLiveToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN)
    .map((e) => e.name)
    .sort();
}

// ── Parity tests ──────────────────────────────────────────────────────────────

Deno.test("parity: every live manifest tool is registered in buildHandlers()", () => {
  const handlers = buildHandlers(context, permissions);
  const registeredNames = [...handlers.keys()].sort();
  const manifestNames = manifestLiveToolNames();

  const missing = manifestNames.filter((n) => !handlers.has(n as Parameters<typeof handlers.has>[0]));
  assertEquals(
    missing,
    [],
    `The following manifest tools have no handler in buildHandlers(): [${missing.join(", ")}]`,
  );

  assert(registeredNames.length > 0, "buildHandlers() must return at least one handler");
});

Deno.test("parity: every handler in buildHandlers() has a manifest entry", () => {
  const handlers = buildHandlers(context, permissions);
  const manifestNames = new Set(TOOL_MANIFEST.map((e) => e.name));

  const unregistered: string[] = [];
  for (const name of handlers.keys()) {
    if (!manifestNames.has(name)) {
      unregistered.push(name);
    }
  }

  assertEquals(
    unregistered,
    [],
    `The following handlers are in buildHandlers() but missing from the manifest: [${unregistered.join(", ")}]`,
  );
});

Deno.test("parity: buildHandlers() tool count equals manifest live tool count", () => {
  const handlers = buildHandlers(context, permissions);
  const manifestNames = manifestLiveToolNames();

  assertEquals(
    handlers.size,
    manifestNames.length,
    `buildHandlers() has ${handlers.size} handlers but manifest has ${manifestNames.length} live tools. ` +
      `Manifest: [${manifestNames.join(", ")}]`,
  );
});

Deno.test("parity: INTERNAL_ONLY manifest tools are NOT registered in buildHandlers()", () => {
  const handlers = buildHandlers(context, permissions);
  const internalTools = TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.INTERNAL_ONLY)
    .map((e) => e.name);

  for (const name of internalTools) {
    assert(
      !handlers.has(name as Parameters<typeof handlers.has>[0]),
      `INTERNAL_ONLY tool '${name}' must not appear in buildHandlers() output`,
    );
  }
});
