/**
 * @module SearchFilesPortalBoundarySecurityTest
 * @path packages-team/mcp-server/tests/search_files_portal_boundary_security_test.ts
 * @related-files [packages-team/mcp-server/handlers/search_files_tool.ts, packages/tool-runtime/src/tool_registry.ts]
 * @architectural-layer MCP
 * @description Phase 170 Weakness 3 regression test. Every other MCP file-mutation handler
 * (read/write/patch/move/delete/list) resolves and authorizes strictly within the caller's
 * authorized portal via the shared PathSecurity resolver. search_files instead passes an
 * already-joined absolute path straight to ToolRegistry.execute(SEARCH_FILES, ...), which
 * validates only against ToolRegistry.getAllowedRoots() — a global list spanning the
 * workspace, memory, blueprints dirs, the system root itself, and every configured portal's
 * target_path, not just the single portal validatePermission() checked. A caller authorized
 * for one portal can therefore supply a `path` that traverses outside that portal (e.g. "..")
 * and still have search_files succeed, because the system root itself is always an allowed
 * root. This test is intentionally RED until search_files is routed through the same
 * per-portal resolver as the other handlers; do not weaken the assertion to make it pass.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { PortalOperation } from "@exaix/core";
import { SearchFilesTool } from "@exaix-team/mcp-server";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "@exaix/mcp/testing";

Deno.test("security: search_files must not find content outside the authorized portal via path traversal (Phase 170 Weakness 3)", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.READ] }, async (env) => {
    // env.tempDir is outside "TestPortal" but ToolRegistry.getAllowedRoots() still permits it
    // (it includes the system root), even though validatePermission() above only checked "TestPortal".
    const secretFileName = "outside-portal-secret-marker.txt";
    await Deno.writeTextFile(join(env.tempDir, secretFileName), "TOPSECRET");

    const handler = new SearchFilesTool(
      createToolContext(env, { toolRegistry: new ToolRegistry({ config: env.config }) }),
      createPermissionsService(env),
    );

    const response = await handler.execute({
      portal: "TestPortal",
      pattern: secretFileName,
      path: "..",
      agent_role: "test-agent",
    });

    // search_files returns exaix_structured_data content (a `{ files: string[] }` payload),
    // not plain text -- stringify the whole content array so the assertion holds regardless
    // of which MCPContent variant a given tool response uses.
    const serialized = JSON.stringify(response.content);
    assert(
      !serialized.includes(secretFileName),
      `search_files must not return matches outside the authorized portal via a "path": ".." ` +
        `traversal argument, but the response included the outside-portal marker file: ${serialized}`,
    );
  });
});
