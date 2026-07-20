/**
 * @module ToolRegistryBaseDirTest
 * @path packages/tool-runtime/tests/tool_registry_base_dir_test.ts
 * @description Verifies ToolRegistry.getBaseDir() exposes the resolved baseDir
 * (the worktree-aware execution root a caller constructed it with), and
 * defaults to config.system.root when no explicit baseDir option is given.
 * CliDelegateStrategy (packages/execution/src/strategies/cli_delegate_strategy.ts)
 * relies on this to run a headless CLI delegate in the same directory
 * ReActLoopStrategy's tool calls already operate in (worktree-scoped when the
 * plan's execution strategy is WORKTREE).
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";

Deno.test("ToolRegistry.getBaseDir(): returns the explicit baseDir option, resolved to an absolute path", () => {
  const config = createMockConfig("/tmp/exaix-base-dir-test-root");
  const registry = new ToolRegistry({ config, baseDir: "/tmp/exaix-base-dir-test-worktree" });

  assertEquals(registry.getBaseDir(), resolve("/tmp/exaix-base-dir-test-worktree"));
});

Deno.test("ToolRegistry.getBaseDir(): defaults to config.system.root when baseDir is omitted", () => {
  const config = createMockConfig("/tmp/exaix-base-dir-test-root2");
  const registry = new ToolRegistry({ config });

  assertEquals(registry.getBaseDir(), resolve(config.system.root));
});
