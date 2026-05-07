/**
 * @module TestHelpersSelfTest
 * @path tests/helpers/test_helpers.ts
 * @description Self-tests for the primary test helper repository, ensuring stable delivery
 * of mock files, request factories, and common visual primitives.
 */

import type { IDatabaseService } from "../../src/services/core/db.ts";
import type { ActivityRepository } from "@exaix/core/repositories/activity_repository.ts";
import { type Config, ConfigSchema } from "@exaix/schemas/config.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers/common.ts";
import type { IConfigService, IDisplayService, IGitService, IPortalConfigEntry } from "@exaix/core/types";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import type { PortalExecutionStrategy } from "@exaix/core";
import type { JSONObject, JSONValue, LogMetadata } from "@exaix/core/types/json.ts";
import { ExaPathDefaults, LogLevel, PortalOperation } from "@exaix/core";
import { createGitServiceStub } from "@exaix/testing/helpers/mod.ts";
import { TEST_DEFAULT_BRANCH } from "./constants.ts";

/**
 * Create a fully-typed stub implementation of the DatabaseService used in tests.
 * Returns an object matching `IDatabaseService` with no-op implementations so
 * tests can pass it without casting to `any`.
 */
export function createStubDb(overrides: Partial<IDatabaseService> = {}): IDatabaseService {
  const base: IDatabaseService = {
    logActivity: (
      _actor: string,
      _actionType: string,
      _target: string | null,
      _payload: JSONObject,
      _traceId?: string,
      _identityId?: string | null,
    ) => {
      /* noop */
    },
    waitForFlush: () => Promise.resolve(),
    queryActivity: () => Promise.resolve([]),
    preparedGet: <T>(_query: string, _params: (string | number | boolean | null)[] = []) =>
      Promise.resolve(null as T | null),
    preparedAll: <T>(_query: string, _params: (string | number | boolean | null)[] = []) => Promise.resolve([] as T[]),
    preparedRun: (_query: string, _params: (string | number | boolean | null)[] = []) => Promise.resolve({}),
    getActivitiesByTrace: (_traceId: string) => [],
    // The "Safe" variants delegate to the possibly-overridden sync method so tests
    // that provide a spy for `getActivitiesByTrace` or `getActivitiesByActionType`
    // still get invoked. This keeps backwards compatibility.
    getActivitiesByTraceSafe: async function (this: IDatabaseService, _traceId: string) {
      if (typeof this.getActivitiesByTrace === "function") {
        const r = this.getActivitiesByTrace(_traceId);
        return r instanceof Promise ? await r : r;
      }
      return [];
    },
    getActivitiesByActionType: (_actionType: string) => [],
    getActivitiesByActionTypeSafe: async function (this: IDatabaseService, _actionType: string) {
      if (typeof this.getActivitiesByActionType === "function") {
        const r = this.getActivitiesByActionType(_actionType);
        return r instanceof Promise ? await r : r;
      }
      return [];
    },
    getRecentActivity: (_limit?: number) => Promise.resolve([]),
    close: () => Promise.resolve(),
  };

  return Object.assign(base, overrides);
}

/**
 * Create a typed ActivityRepository mock for tests.
 */
export function createMockRepo(overrides: Partial<ActivityRepository> = {}): ActivityRepository {
  const base: ActivityRepository = {
    logActivity: () => Promise.resolve(),
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  return Object.assign(base, overrides);
}

/**
 * Create a stub IConfigService for tests.
 */
export function createStubConfig(config: Config): IConfigService {
  const portals: IPortalConfigEntry[] = [...(config.portals ?? [])];

  const getConfig = (): Config => ({
    ...config,
    portals: portals.map((p): IPortalPermissions => ({
      alias: p.alias,
      target_path: p.target_path,
      created: p.created,
      default_branch: p.default_branch ?? TEST_DEFAULT_BRANCH,
      identities_allowed: p.identities_allowed ?? ["*"],
      operations: p.operations ?? [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    })),
  });

  return {
    get: () => getConfig(),
    getAll: () => getConfig(),
    getConfigPath: () => "/mock/exa.config.toml",
    reload: () => getConfig(),
    addPortal: (alias: string, targetPath: string, options?: {
      defaultBranch?: string;
      executionStrategy?: PortalExecutionStrategy;
    }) => {
      const existingIndex = portals.findIndex((portal) => portal.alias === alias);
      const next: IPortalConfigEntry = {
        alias,
        target_path: targetPath,
        created: new Date().toISOString(),
        default_branch: options?.defaultBranch || TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        execution_strategy: options?.executionStrategy,
      };

      if (existingIndex >= 0) {
        portals[existingIndex] = next;
      } else {
        portals.push(next);
      }

      return Promise.resolve();
    },
    removePortal: (alias: string) => {
      const index = portals.findIndex((portal) => portal.alias === alias);
      if (index >= 0) {
        portals.splice(index, 1);
      }
      return Promise.resolve();
    },
    getPortals: () => [...portals],
    getPortal: (alias: string) => portals.find((portal) => portal.alias === alias),
    getSchemaVersion: () => config.system.schema_version ?? "1.0.0",
  };
}

/**
 * Build a minimal IGenerateResult from a content string.
 * Convenience helper for test stubs.
 */
export function makeGenerateResult(content: string, overrides: Partial<IGenerateResult> = {}): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "mock-model",
    provider: "mock-provider",
    cost_usd: 0,
    ...overrides,
  };
}

/**
 * Create a stub IModelProvider for tests.
 */
export function createStubProvider(responseContent = "Mock response"): IModelProvider {
  return {
    id: "mock-provider",
    generate: () => Promise.resolve(makeGenerateResult(responseContent)),
  };
}

/**
 * Create a stub IGitService for tests.
 * Returns an object matching `IGitService` with no-op implementations.
 */
export function createStubGit(overrides: Partial<IGitService> = {}): IGitService {
  // Backwards compatibility: provide legacy defaults for existing tests
  const defaults: Partial<IGitService> = {
    getRepository: () => "/mock/repo",
    createBranch: () => Promise.resolve("feature/test"),
    commit: () => Promise.resolve("abcdef"),
  };
  return createGitServiceStub({ ...defaults, ...overrides });
}

/**
 * Create a stub IDisplayService for tests.
 */
export function createStubDisplay(db?: IDatabaseService): IDisplayService {
  const logWithLevel = (
    action: string,
    target: string | null,
    payload: LogMetadata = {},
    traceId?: string,
  ): Promise<void> => {
    if (!db) {
      return Promise.resolve();
    }
    db.logActivity(
      "system",
      action,
      target,
      payload as Record<string, JSONValue>,
      traceId,
      null,
    );
    return Promise.resolve();
  };

  const display: IDisplayService = {
    info: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) =>
      logWithLevel(action, target, payload, traceId),
    warn: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) =>
      logWithLevel(action, target, payload, traceId),
    error: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) =>
      logWithLevel(action, target, payload, traceId),
    debug: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) =>
      logWithLevel(action, target, payload, traceId),
    fatal: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) =>
      logWithLevel(action, target, payload, traceId),
  };

  return display;
}

/**
 * Create a stub ICliApplicationContext for tests.
 */
export function createStubContext(overrides: Partial<ICliApplicationContext> = {}): ICliApplicationContext {
  const root = "/tmp/exa-test";
  const config: Config = ConfigSchema.parse({
    system: { root, log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  });

  const base: ICliApplicationContext = {
    db: createStubDb(),
    config: createStubConfig(config),
    provider: createStubProvider(),
    git: createStubGit(),
    display: createStubDisplay(),
  };
  const context = Object.assign(base, overrides);

  if (!overrides.display) {
    context.display = createStubDisplay(context.db);
  }

  return context;
}

/**
 * Bypass strict TypeScript casting in tests — avoids double `as` casts.
 * Usage: castAny<IModelProvider>({ generate: ... })
 */
export function castAny<T>(val: object): T {
  return val as T;
}
