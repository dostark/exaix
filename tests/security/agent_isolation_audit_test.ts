// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentIsolationAuditTest
 * @path tests/security/agent_isolation_audit_test.ts
 * @description Step 61.7 (G3) + Step 61.11 (G7): Verifies that AgentComposer.executeStep()
 * detects unauthorized file modifications via post-execution git audit,
 * logs a security.violation event, and throws AgentExecutionError(SECURITY_VIOLATION).
 *
 * Success Criteria (Step 61.7 + 61.11):
 * - executeStep() throws AgentExecutionError with type SECURITY_VIOLATION
 * - logger.error() is called with action AGENT_EVENT_SECURITY_VIOLATION
 * - payload contains portal, unauthorized_files, and agent_role fields
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentComposer, AgentExecutionError, type IAgentFileBlueprint } from "@exaix/execution";
import type { IExecutionStrategy } from "@exaix/execution";
import { StrategyRegistry } from "@exaix/execution";
import type { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { AGENT_EVENT_SECURITY_VIOLATION } from "@exaix/core";
import { GIT_EMPTY_SHA } from "@exaix/git";
import { AgentExecutionErrorType, ExecutionStrategyName, PortalOperation } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { LogMetadata } from "@exaix/core/types";
import { createMockConfig } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { initTestDbService } from "@exaix/testing";

interface IErrorCapture {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

function createAuditMockLogger(): { logger: EventLogger; errors: IErrorCapture[] } {
  const errors: IErrorCapture[] = [];
  const logger = {
    log: (): Promise<void> => Promise.resolve(),
    error: (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
      errors.push({ action, target, payload });
      return Promise.resolve();
    },
    info: (): Promise<void> => Promise.resolve(),
    warn: (): Promise<void> => Promise.resolve(),
    debug: (): Promise<void> => Promise.resolve(),
    fatal: (): Promise<void> => Promise.resolve(),
  } as Partial<EventLogger>;

  return { logger: logger as EventLogger, errors };
}

Deno.test({
  name: "[security] Audit: unauthorized file triggers SECURITY_VIOLATION throw and security.violation log",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;

    try {
      const portalDir = join(tempDir, "AuditPortal");
      await Deno.mkdir(portalDir, { recursive: true });

      const git = (args: string[]) =>
        new Deno.Command("git", {
          args,
          cwd: portalDir,
          stderr: "null",
        }).output();

      await git(["init"]);
      await git(["config", "user.name", "Audit Test"]);
      await git(["config", "user.email", "audit@test.local"]);
      await Deno.writeTextFile(join(portalDir, "README.md"), "# Audit Portal\n");
      await git(["add", "README.md"]);
      await git(["commit", "-m", "Initial commit"]);

      const blueprintsDir = join(tempDir, "Blueprints", "Agents");
      await Deno.mkdir(blueprintsDir, { recursive: true });
      await Deno.writeTextFile(
        join(blueprintsDir, "audit-agent.md"),
        "---\nmodel: mock\ncapabilities: []\n---\nAudit agent blueprint\n",
      );

      const config = createMockConfig(tempDir, {
        portals: [{
          alias: "audit-portal",
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          agents_allowed: ["*"],
          operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        }],
      });
      const { logger, errors } = createAuditMockLogger();

      const mockStrategy: IExecutionStrategy = {
        name: ExecutionStrategyName.LEGACY,
        execute: async (
          _blueprint: IAgentFileBlueprint,
          _context: IExecutionContext,
          _options: IAgentExecutionOptions,
        ): Promise<IChangesetResult> => {
          await Deno.writeTextFile(
            join(portalDir, "unauthorized.txt"),
            "This file was not authorized\n",
          );
          return {
            branch: "feat/audit-test",
            commit_sha: GIT_EMPTY_SHA,
            files_changed: [],
            description: "audit test execution",
            tool_calls: 0,
            execution_time_ms: 0,
          };
        },
      };

      const registry = new StrategyRegistry();
      registry.register(mockStrategy);

      const permissions = new PortalPermissionsService([{
        alias: "audit-portal",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      }]);
      const pathResolver = new PathResolver(config);

      const executor = new AgentComposer({
        config,
        db: dbService.db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry: registry,
      });

      const err = await assertRejects(
        () =>
          executor.executeStep(
            {
              trace_id: crypto.randomUUID(),
              request_id: "req-audit-001",
              request: "test request",
              plan: "test plan",
              portal: "audit-portal",
            },
            {
              agent_role: "audit-agent",
              portal: "audit-portal",
              allowed_paths: [],
            },
          ),
        AgentExecutionError,
      );

      assertEquals(
        (err as AgentExecutionError).type,
        AgentExecutionErrorType.SECURITY_VIOLATION,
        "Error type must be SECURITY_VIOLATION",
      );

      const violationLog = errors.find((event) => event.action === AGENT_EVENT_SECURITY_VIOLATION);
      assertEquals(
        violationLog !== undefined,
        true,
        "logger.error must be called with the shared security violation action",
      );
      assertEquals(
        violationLog!.payload?.["portal"],
        "audit-portal",
        "violation payload must include portal alias",
      );

      const unauthorizedFiles = violationLog!.payload?.["unauthorized_files"];
      assertEquals(
        Array.isArray(unauthorizedFiles),
        true,
        "violation payload must include unauthorized_files array",
      );
      assertEquals(
        (unauthorizedFiles as any[]).length > 0,
        true,
        "violation payload must include at least one unauthorized file",
      );
      assertEquals(
        violationLog!.payload?.["agent_role"],
        "audit-agent",
        "violation payload must include agent_role",
      );
    } finally {
      await dbService.cleanup();
    }
  },
});

Deno.test({
  name: "[security] Audit: authorized files are not flagged as security violations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;

    try {
      const portalDir = join(tempDir, "AuthPortal");
      await Deno.mkdir(portalDir, { recursive: true });

      const git = (args: string[]) =>
        new Deno.Command("git", {
          args,
          cwd: portalDir,
          stderr: "null",
        }).output();

      await git(["init"]);
      await git(["config", "user.name", "Auth Test"]);
      await git(["config", "user.email", "auth@test.local"]);
      await Deno.writeTextFile(join(portalDir, "README.md"), "# Auth Portal\n");
      await git(["add", "README.md"]);
      await git(["commit", "-m", "Initial commit"]);

      const blueprintsDir = join(tempDir, "Blueprints", "Agents");
      await Deno.mkdir(blueprintsDir, { recursive: true });
      await Deno.writeTextFile(
        join(blueprintsDir, "auth-agent.md"),
        "---\nmodel: mock\ncapabilities: []\n---\nAuth agent blueprint\n",
      );

      const config = createMockConfig(tempDir, {
        portals: [{
          alias: "auth-portal",
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          agents_allowed: ["*"],
          operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        }],
      });
      const { logger, errors } = createAuditMockLogger();

      const mockStrategy: IExecutionStrategy = {
        name: ExecutionStrategyName.LEGACY,
        execute: async (): Promise<IChangesetResult> => {
          await Deno.writeTextFile(join(portalDir, "authorized.txt"), "This file is authorized\n");
          return {
            branch: "feat/auth-test",
            commit_sha: GIT_EMPTY_SHA,
            files_changed: ["authorized.txt"],
            description: "authorized test execution",
            tool_calls: 0,
            execution_time_ms: 0,
          };
        },
      };

      const registry = new StrategyRegistry();
      registry.register(mockStrategy);

      const permissions = new PortalPermissionsService([{
        alias: "auth-portal",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      }]);
      const pathResolver = new PathResolver(config);

      const executor = new AgentComposer({
        config,
        db: dbService.db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry: registry,
      });

      const result = await executor.executeStep(
        {
          trace_id: crypto.randomUUID(),
          request_id: "req-auth-001",
          request: "test request",
          plan: "test plan",
          portal: "auth-portal",
        },
        {
          agent_role: "auth-agent",
          portal: "auth-portal",
          allowed_paths: ["authorized.txt"],
        },
      );

      const violationCount = errors.filter((event) => {
        return event.action === AGENT_EVENT_SECURITY_VIOLATION;
      }).length;

      assertEquals(
        violationCount,
        0,
        "No security.violation must be logged for authorized files",
      );
      assertEquals(
        result.commit_sha !== GIT_EMPTY_SHA,
        true,
        "commit_sha must be overridden with real HEAD SHA",
      );
    } finally {
      await dbService.cleanup();
    }
  },
});
