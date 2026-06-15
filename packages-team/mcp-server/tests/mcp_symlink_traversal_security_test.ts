/**
 * @module McpSymlinkTraversalSecurityTest
 * @path packages-team/mcp-server/tests/mcp_symlink_traversal_security_test.ts
 * @related-files [packages/mcp/server/tool_handler.ts, packages/tool-runtime/src/path_security.ts]
 * @architectural-layer MCP
 * @description Security regression for Finding 3 (Exaix_Security_Vulnerability_Analysis.md).
 * MCP file handlers must resolve symlinks before enforcing the portal boundary. A symlink
 * inside a portal that points outside it must not let write_file / read_file escape the
 * portal — string-only `..` checks are insufficient because they never follow symlinks.
 */

import { assert } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { PortalOperation } from "@exaix/core";
import { ReadFileTool, WriteFileTool } from "@exaix-team/mcp-server";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "@exaix/mcp/testing";

/** Creates `<portal>/escape` as a symlink to an out-of-portal directory and returns it. */
async function linkEscapeDir(portalPath: string, tempDir: string): Promise<string> {
  const outsideDir = join(tempDir, "outside-portal");
  await Deno.mkdir(outsideDir, { recursive: true });
  await Deno.symlink(outsideDir, join(portalPath, "escape"));
  return outsideDir;
}

Deno.test("security: write_file cannot write through an in-portal symlink escaping the portal", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const outsideDir = await linkEscapeDir(env.portalPath, env.tempDir);
    const handler = new WriteFileTool(createToolContext(env), createPermissionsService(env));

    // May throw or return isError — either is acceptable. The security property is that
    // the out-of-portal target is never written.
    await handler.execute({
      portal: "TestPortal",
      path: "escape/pwned.txt",
      content: "PWNED",
      identity_id: "test-agent",
    }).catch(() => undefined);

    assert(
      !(await exists(join(outsideDir, "pwned.txt"))),
      "write_file must not create a file outside the portal via a symlink",
    );
  });
});

Deno.test("security: read_file cannot read through an in-portal symlink escaping the portal", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.READ] }, async (env) => {
    const outsideDir = await linkEscapeDir(env.portalPath, env.tempDir);
    await Deno.writeTextFile(join(outsideDir, "secret.txt"), "TOPSECRET");
    const handler = new ReadFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "escape/secret.txt",
      identity_id: "test-agent",
    }).catch(() => ({ content: [{ type: "text", text: "blocked" }] }));

    const text = response.content.map((c) => (c as { text?: string }).text ?? "").join("");
    assert(
      !text.includes("TOPSECRET"),
      "read_file must not return content from outside the portal via a symlink",
    );
  });
});
