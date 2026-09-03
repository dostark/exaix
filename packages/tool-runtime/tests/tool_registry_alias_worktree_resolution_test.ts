/**
 * @module ToolRegistryAliasWorktreeResolutionTest
 * @path packages/tool-runtime/tests/tool_registry_alias_worktree_resolution_test.ts
 * @description Phase 140a Step 5 — RED-first test. ToolRegistry.resolvePath's `@alias` branch
 * previously ignored `this.baseDir` (the active git worktree, when a plan runs under
 * PortalExecutionStrategy.WORKTREE) and always resolved a portal alias to `portal.target_path`
 * via PathResolver — bypassing the worktree isolation setupPortalWorktreeExecution builds.
 * Verifies a ToolRegistry constructed with an explicit worktree baseDir resolves its OWN
 * portal's `@<alias>/...` path into that worktree, not the live mounted portal.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/src/path_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { ToolName } from "@exaix/core";

const PORTAL_ALIAS = "todo-app";

Deno.test("[ToolRegistryAliasWorktreeResolution] @<matching-portal>/path writes into the active worktree baseDir, not the live portal", async () => {
  const portalDir = await Deno.makeTempDir({ prefix: "alias-worktree-portal-" });
  const systemRoot = await Deno.makeTempDir({ prefix: "alias-worktree-root-" });
  // Mirrors the real worktree layout: system.root/.exa/worktrees/<portalAlias>/<traceId>/,
  // per GitExecutionSetupService.buildPortalWorktreePath — nested under system.root, which
  // getAllowedRoots() always includes.
  const worktreeDir = join(systemRoot, ".exa", "worktrees", PORTAL_ALIAS, "trace-1");
  await Deno.mkdir(worktreeDir, { recursive: true });

  try {
    const config = createMockConfig(systemRoot, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: portalDir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const registry = new ToolRegistry({ config, baseDir: worktreeDir });

    const result = await registry.execute(ToolName.WRITE_FILE, {
      path: `@${PORTAL_ALIAS}/fixed.ts`,
      content: "// fixed in worktree",
    });

    assertEquals(result.success, true, `write failed: ${result.error}`);

    const worktreeFileExists = await Deno.stat(join(worktreeDir, "fixed.ts")).then(() => true).catch(() => false);
    const portalFileExists = await Deno.stat(join(portalDir, "fixed.ts")).then(() => true).catch(() => false);

    assertEquals(worktreeFileExists, true, "expected the write to land in the worktree");
    assertEquals(portalFileExists, false, "the live mounted portal must NOT receive the write");
  } finally {
    await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeDir, { recursive: true }).catch(() => {});
    await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
  }
});
