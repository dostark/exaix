/**
 * @module ToolRegistryPortalAccessTest
 * @path tests/services/tool/tool_registry_portal_access_test.ts
 * @description Verifies the ToolRegistry's security model for portal-bound execution,
 * ensuring tools can safely access and manipulate files within approved portal targets.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "../../../src/services/tool/tool_registry.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { ExaPathDefaults } from "@exaix/core";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry should allow access to portal targets", async () => {
  const portalDir = await Deno.makeTempDir({ prefix: "portal-target-" });
  const workspaceDir = await Deno.makeTempDir({ prefix: "workspace-" });

  try {
    const config: Config = {
      system: { root: workspaceDir, log_level: "info" },
      paths: { ...ExaPathDefaults },
      portals: [
        { alias: "TestPortal", target_path: portalDir },
      ],
      // Minimal required config
      agents: { default_model: "mock:test" },
      models: {},
      database: {},
      watcher: {},
    } as Partial<Config> as Config;

    const registry = new ToolRegistry({ config });

    // 1. Write to workspace should succeed (baseline)
    const workspaceRes = await registry.execute(ToolName.WRITE_FILE, {
      path: join(workspaceDir, "test.txt"),
      content: "workspace content",
    });
    assertEquals(workspaceRes.success, true, `Workspace write failed: ${workspaceRes.error}`);

    // 2. Write to portal target should succeed
    const portalFile = join(portalDir, "portal.txt");
    const portalRes = await registry.execute(ToolName.WRITE_FILE, {
      path: portalFile,
      content: "portal content",
    });

    if (!portalRes.success) {
      console.log("Portal write failed:", portalRes.error);
    }

    assertEquals(portalRes.success, true, `Portal write should succeed. Error: ${portalRes.error}`);
  } finally {
    await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    await Deno.remove(workspaceDir, { recursive: true }).catch(() => {});
  }
});
