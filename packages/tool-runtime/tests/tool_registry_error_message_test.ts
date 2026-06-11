/**
 * @module ToolRegistryErrorMessageTest
 * @path packages/tool-runtime/tests/tool_registry_error_message_test.ts
 * @description Verifies the ToolRegistry's error reporting logic: security denials are
 * reported to the caller WITHOUT disclosing absolute filesystem paths or the allowed-root
 * list (Finding 10) — that detail is reserved for the operator journal.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: access-denied error does not leak absolute roots to the caller", async () => {
  const workspaceDir = await Deno.makeTempDir({ prefix: "workspace-" });
  const outsideDir = await Deno.makeTempDir({ prefix: "outside-" });

  try {
    await Deno.mkdir(join(workspaceDir, "Workspace"));
    await Deno.mkdir(join(workspaceDir, "Memory"));
    await Deno.mkdir(join(workspaceDir, "Blueprints"));

    const config = createTestConfig();
    config.system.root = workspaceDir;

    const registry = new ToolRegistry({ config });

    // Try to write to a path outside valid roots.
    const outsideFile = join(outsideDir, "test.txt");
    const result = await registry.execute(ToolName.WRITE_FILE, {
      path: outsideFile,
      content: "content",
    });

    // The operation is denied.
    assertEquals(result.success, false, "Write to outside directory should fail");
    assertStringIncludes(result.error || "", "Access denied");

    // But the caller-facing message must not disclose host filesystem layout.
    assertEquals((result.error || "").includes("Allowed roots:"), false, "must not leak the allowed-roots list");
    assertEquals((result.error || "").includes(workspaceDir), false, "must not leak the absolute workspace path");
    assertEquals((result.error || "").includes(outsideDir), false, "must not echo the attempted absolute path");
  } finally {
    await Deno.remove(workspaceDir, { recursive: true }).catch(() => {});
    await Deno.remove(outsideDir, { recursive: true }).catch(() => {});
  }
});
