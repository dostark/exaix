/**
 * @module ToolRegistryErrorMessageTest
 * @path packages/tool-runtime/tests/tool_registry_error_message_test.ts
 * @description Verifies the ToolRegistry's error reporting logic, ensuring that security
 * denials include helpful context about allowed directory roots and portal boundaries.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry should include allowed roots in access denied error", async () => {
  const workspaceDir = await Deno.makeTempDir({ prefix: "workspace-" });
  const outsideDir = await Deno.makeTempDir({ prefix: "outside-" });

  try {
    await Deno.mkdir(join(workspaceDir, "Workspace"));
    await Deno.mkdir(join(workspaceDir, "Memory"));
    await Deno.mkdir(join(workspaceDir, "Blueprints"));

    const config = createTestConfig();
    config.system.root = workspaceDir;

    const registry = new ToolRegistry({ config });

    // Try to write to a path outside valid roots
    const outsideFile = join(outsideDir, "test.txt");
    const result = await registry.execute(ToolName.WRITE_FILE, {
      path: outsideFile,
      content: "content",
    });

    // Verify it failed
    assertEquals(result.success, false, "Write to outside directory should fail");

    // Verify error message content
    // Expected: "Access denied: Path outside allowed directories. Allowed roots: ..."
    assertStringIncludes(result.error || "", "Access denied: Path outside allowed directories");
    assertStringIncludes(result.error || "", "Allowed roots:");

    // Verify workspace (resolved) is in the allowed roots list
    const realWorkspace = await Deno.realPath(join(workspaceDir, "Workspace"));
    assertStringIncludes(result.error || "", realWorkspace);
  } finally {
    await Deno.remove(workspaceDir, { recursive: true }).catch(() => {});
    await Deno.remove(outsideDir, { recursive: true }).catch(() => {});
  }
});
