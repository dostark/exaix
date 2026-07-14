/**
 * @module ToolTestHelpers
 * @path packages/tool-runtime/tests/helpers.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Shared setup helpers for tool registry tests.
 */

import { ToolRegistry } from "@exaix/tool-runtime";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { IGitServiceFactory, JSONObject } from "@exaix/core/types";

interface ICreateRegistryOptions {
  tools?: JSONObject;
  gitServiceFactory?: IGitServiceFactory;
}

export function createToolRegistryForTests(tempDir: string, options: ICreateRegistryOptions = {}): ToolRegistry {
  const config = ConfigSchema.parse({
    system: { root: tempDir },
    tools: options.tools ?? {},
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });

  return new ToolRegistry({ config, baseDir: tempDir, gitServiceFactory: options.gitServiceFactory });
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

const DANGEROUS_GIT_OPTIONS = [
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config",
  "--config-env",
  "--exec",
  "--html-path",
];

/**
 * Validate git args for test purposes — mirrors the security checks from GitService.validateArgs.
 */
export function validateTestGitArgs(args: string[]): { valid: boolean; reason?: string } {
  const dangerousExactOptions = ["-c", "-C"];
  for (const arg of args) {
    if (dangerousExactOptions.includes(arg) || DANGEROUS_GIT_OPTIONS.some((opt) => arg.startsWith(opt))) {
      return { valid: false, reason: `Dangerous git option not allowed: ${arg}` };
    }
  }
  return { valid: true };
}

/** Create a stub IGitServiceFactory for tests that provides git argument validation. */
export function createTestGitServiceFactory(): IGitServiceFactory {
  return {
    createGitService: () => ({
      setRepository: () => {},
      getRepository: () => "",
      ensureRepository: () => Promise.resolve(),
      ensureIdentity: () => Promise.resolve(),
      createBranch: () => Promise.resolve(""),
      commit: () => Promise.resolve(""),
      checkoutBranch: () => Promise.resolve(),
      getCurrentBranch: () => Promise.resolve(""),
      getDefaultBranch: () => Promise.resolve(""),
      addWorktree: () => Promise.resolve(),
      removeWorktree: () => Promise.resolve(),
      pruneWorktrees: () => Promise.resolve(""),
      listWorktrees: () => Promise.resolve([]),
      runGitCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
      validateArgs: validateTestGitArgs,
    }),
  };
}
