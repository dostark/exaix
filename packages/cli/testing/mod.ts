/**
 * @module CLITesting
 * @path packages/cli/testing/mod.ts
 * @architectural-layer CLI
 * @ungrounded
 * @related-files []
 * @description Exports stub factories and test utilities for @exaix/cli consumers.
 * This is a published support API surface — never import from packages/cli/tests/.
 */

import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { IConfigService, IDatabaseService, IDisplayService, IGitService } from "@exaix/core/types";
import type { IModelProvider } from "@exaix/ai";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { Opt, Reason } from "@exaix/core/types";

// Stub factories

export function createStubGitService(
  overrides: Opt<Partial<IGitService>, Reason.TestOverride> = {},
): IGitService {
  return {
    setRepository: () => {},
    getRepository: () => "",
    ensureRepository: () => Promise.resolve(),
    ensureIdentity: () => Promise.resolve(),
    createBranch: () => Promise.resolve(""),
    commit: () => Promise.resolve(""),
    checkoutBranch: () => Promise.resolve(),
    getCurrentBranch: () => Promise.resolve("main"),
    getDefaultBranch: () => Promise.resolve("main"),
    addWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    pruneWorktrees: () => Promise.resolve(""),
    listWorktrees: () => Promise.resolve([]),
    runGitCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
    validateArgs: () => ({ valid: true }),
    ...overrides,
  };
}

export function createStubDatabase(
  overrides: Opt<Partial<IDatabaseService>, Reason.TestOverride> = {},
): IDatabaseService {
  const noop = () => {};
  const asyncNoop = async () => {};
  return {
    logActivity: noop,
    waitForFlush: asyncNoop,
    queryActivity: () => Promise.resolve([]),
    close: asyncNoop,
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve(),
    getActivitiesByTrace: () => [],
    getActivitiesByTraceSafe: () => Promise.resolve([]),
    getActivitiesByActionType: () => [],
    getActivitiesByActionTypeSafe: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
    insertToolConfirmationRequest: () => Promise.resolve(),
    writeToolConfirmationDecision: () => Promise.resolve(),
    getToolConfirmationDecision: () => Promise.resolve(null),
    listPendingToolConfirmations: () => Promise.resolve([]),
    ...overrides,
  };
}

const defaultConfig = ConfigSchema.parse({
  system: {},
  paths: {},
});

export function createStubConfigService(
  overrides: Opt<Partial<IConfigService>, Reason.TestOverride> = {},
): IConfigService {
  return {
    get: () => defaultConfig,
    getAll: () => defaultConfig,
    getConfigPath: () => "",
    reload: () => defaultConfig,
    addPortal: () => Promise.resolve(),
    removePortal: () => Promise.resolve(),
    getPortals: () => [],
    getPortal: () => undefined,
    getSchemaVersion: () => "",
    ...overrides,
  };
}

export function createStubDisplay(): IDisplayService {
  const noop = async () => {};
  return { info: noop, warn: noop, error: noop, debug: noop, fatal: noop };
}

export function createStubProvider(
  overrides: Partial<IModelProvider> = {},
): IModelProvider {
  return {
    id: "stub",
    generate: () =>
      Promise.resolve({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub",
        provider: "stub",
      }),
    ...overrides,
  };
}

/** Create a minimal ICliApplicationContext with all-optional stubs for testing. */
export function createStubCliContext(
  overrides: Partial<ICliApplicationContext> = {},
): ICliApplicationContext {
  return {
    config: createStubConfigService(),
    db: createStubDatabase(),
    provider: createStubProvider(),
    git: createStubGitService(),
    display: createStubDisplay(),
    ...overrides,
  };
}

// Console capture helper

/**
 * Captures console.log output during the execution of a function.
 */
export async function captureConsoleOutput(
  fn: () => Promise<void> | void,
): Promise<string> {
  let out = "";
  const origLog = console.log;
  console.log = (msg: string) => (out += msg + "\n");
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return out;
}
