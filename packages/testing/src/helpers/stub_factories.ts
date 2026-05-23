/**
 * @module StubFactories
 * @path packages/testing/src/helpers/stub_factories.ts
 * @description Shared factory functions for creating stub implementations of
 * core services used in CLI initialization and testing.
 * @architectural-layer CLI
 * @ungrounded
 * @related-files [apps/exactl/src/init.ts, "apps/tui/src/services/tui_service_factory.ts", "tests/helpers/test_helpers.ts"]
 */

import type { IGitService } from "@exaix/core/types";
import type { IModelProvider } from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";

import { GitBranchName } from "@exaix/git";

/**
 * Create a stub IGitService with no-op implementations.
 * Useful for CLI initialization and testing.
 */
export function createGitServiceStub(overrides: Partial<IGitService> = {}): IGitService {
  const base: IGitService = {
    setRepository: () => {},
    getRepository: () => "",
    ensureRepository: () => Promise.resolve(),
    ensureIdentity: () => Promise.resolve(),
    createBranch: () => Promise.resolve(""),
    commit: () => Promise.resolve(""),
    checkoutBranch: () => Promise.resolve(),
    getCurrentBranch: () => Promise.resolve(GitBranchName.MAIN),
    getDefaultBranch: () => Promise.resolve(GitBranchName.MAIN),
    addWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    pruneWorktrees: () => Promise.resolve(""),
    listWorktrees: () => Promise.resolve([]),
    runGitCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
  };
  return { ...base, ...overrides };
}

/**
 * Create a stub IModelProvider with minimal implementation.
 * Useful for CLI initialization and testing.
 */
export function createProviderStub(overrides: Partial<IModelProvider> = {}): IModelProvider {
  const base: IModelProvider = {
    id: "stub-provider",
    generate: (): Promise<IGenerateResult> =>
      Promise.resolve({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub-model",
        provider: "stub-provider",
        cost_usd: 0,
      }),
  };
  return { ...base, ...overrides };
}
