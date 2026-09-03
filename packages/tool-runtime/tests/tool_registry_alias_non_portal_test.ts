/**
 * @module ToolRegistryAliasNonPortalTest
 * @path packages/tool-runtime/tests/tool_registry_alias_non_portal_test.ts
 * @description Phase 140a Step 5 — regression test. Worktree-aware @alias resolution
 * (tool_registry.ts:resolvePath) must apply ONLY to a portal alias matching THIS registry's own
 * portal while an explicit worktree baseDir is active — every other alias (@Blueprints, @Memory,
 * @Runtime, @Workspace, or a portal alias NOT registered) must still delegate to the injected
 * pathResolver exactly as before this step.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/src/path_resolver.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { ToolName } from "@exaix/core";

const REGISTERED_PORTAL_ALIAS = "todo-app";
const OTHER_PORTAL_ALIAS = "some-other-portal";

function makeFakePathResolver(calls: string[], resolveTo: (path: string) => string) {
  return {
    resolve: (path: string) => {
      calls.push(path);
      return Promise.resolve(resolveTo(path));
    },
  };
}

Deno.test("[ToolRegistryAliasNonPortal] a non-portal alias (@Blueprints) still delegates to pathResolver even with an active worktree baseDir", async () => {
  const worktreeDir = await Deno.makeTempDir({ prefix: "alias-non-portal-worktree-" });
  const blueprintsDir = await Deno.makeTempDir({ prefix: "alias-non-portal-blueprints-" });
  const systemRoot = await Deno.makeTempDir({ prefix: "alias-non-portal-root-" });

  try {
    const config = createMockConfig(systemRoot, {
      portals: [{
        alias: REGISTERED_PORTAL_ALIAS,
        target_path: join(systemRoot, "portal"),
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });

    const calls: string[] = [];
    const pathResolver = makeFakePathResolver(calls, () => join(blueprintsDir, "agent.md"));

    const registry = new ToolRegistry({ config, baseDir: worktreeDir, pathResolver });

    const result = await registry.execute(ToolName.READ_FILE, { path: "@Blueprints/agent.md" });

    // The file doesn't exist, but what matters is that pathResolver.resolve was invoked with the
    // untouched @Blueprints path — proving resolution was delegated, not intercepted.
    assertEquals(result.success, false);
    assertEquals(calls, ["@Blueprints/agent.md"]);
  } finally {
    await Deno.remove(worktreeDir, { recursive: true }).catch(() => {});
    await Deno.remove(blueprintsDir, { recursive: true }).catch(() => {});
    await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
  }
});

Deno.test("[ToolRegistryAliasNonPortal] a portal alias NOT registered on this ToolRegistry's config still delegates to pathResolver", async () => {
  const worktreeDir = await Deno.makeTempDir({ prefix: "alias-non-portal-worktree2-" });
  const systemRoot = await Deno.makeTempDir({ prefix: "alias-non-portal-root2-" });

  try {
    const config = createMockConfig(systemRoot, {
      portals: [{
        alias: REGISTERED_PORTAL_ALIAS,
        target_path: join(systemRoot, "portal"),
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });

    const calls: string[] = [];
    const pathResolver = makeFakePathResolver(calls, () => {
      throw new Error(`Unknown portal alias: @${OTHER_PORTAL_ALIAS}`);
    });

    const registry = new ToolRegistry({ config, baseDir: worktreeDir, pathResolver });

    await assertRejects(
      () =>
        registry.execute(ToolName.READ_FILE, { path: `@${OTHER_PORTAL_ALIAS}/file.ts` }).then((r) => {
          if (!r.success) throw new Error(r.error);
        }),
    );
    assertEquals(calls, [`@${OTHER_PORTAL_ALIAS}/file.ts`]);
  } finally {
    await Deno.remove(worktreeDir, { recursive: true }).catch(() => {});
    await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
  }
});
