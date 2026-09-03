/**
 * @module ToolRegistryAliasNoWorktreeTest
 * @path packages/tool-runtime/tests/tool_registry_alias_no_worktree_test.ts
 * @description Phase 140a Step 5 — regression test. A ToolRegistry constructed WITHOUT an
 * explicit worktree baseDir (i.e. baseDir defaults to config.system.root — the case for
 * read-only plans and PortalExecutionStrategy.BRANCH executions) must continue resolving
 * `@<portal>/...` to the live portal path via pathResolver exactly as before Step 5 — the
 * worktree substitution in tool_registry.ts:resolvePath only applies when baseDir is an
 * explicit, non-default execution root.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/src/path_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { ToolName } from "@exaix/core";

const PORTAL_ALIAS = "todo-app";

Deno.test("[ToolRegistryAliasNoWorktree] no explicit baseDir: @<portal>/path still resolves to the live portal via pathResolver", async () => {
  const portalDir = await Deno.makeTempDir({ prefix: "alias-no-worktree-portal-" });
  const systemRoot = await Deno.makeTempDir({ prefix: "alias-no-worktree-root-" });

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

    const calls: string[] = [];
    const pathResolver = {
      resolve: (path: string) => {
        calls.push(path);
        return Promise.resolve(join(portalDir, path.split("/").slice(1).join("/")));
      },
    };

    // No baseDir option — defaults to config.system.root, same as a read-only or BRANCH-strategy
    // plan's ToolRegistry construction.
    const registry = new ToolRegistry({ config, pathResolver });

    const result = await registry.execute(ToolName.WRITE_FILE, {
      path: `@${PORTAL_ALIAS}/fixed.ts`,
      content: "// fixed directly on the live portal (no worktree active)",
    });

    assertEquals(result.success, true, `write failed: ${result.error}`);
    assertEquals(calls, [`@${PORTAL_ALIAS}/fixed.ts`]);

    const portalFileExists = await Deno.stat(join(portalDir, "fixed.ts")).then(() => true).catch(() => false);
    assertEquals(portalFileExists, true, "expected the write to land in the live portal (no worktree to isolate into)");
  } finally {
    await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
  }
});
