/**
 * @module ExecutionLoopVerificationTest
 * @path packages/execution/tests/execution_loop_verification_test.ts
 * @related-files ["packages/execution/src/execution_loop.ts", "packages/execution/src/verification_runner.ts"]
 * @architectural-layer Tests
 * @description Drives a real ExecutionLoop in a real git worktree to assert the
 *   post-execution verification status and journaled events for not_configured,
 *   passed, failed, error, skipped and read-only cases.
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_AGENTS_PATH } from "@exaix/shared";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { Database } from "@db/sqlite";
import { stringify as stringifyToml } from "@std/toml";
import {
  ConfigService,
  DaemonConfigAdapter,
  ensureConfigDb,
  getAllEffectiveValues,
  InMemoryConfigStore,
  insertOverride,
  migrateConfigDb,
  seedConfigDb,
} from "@exaix/core/config";
import type { Config } from "@exaix/schemas/config.ts";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { ExecutionLoop, type IVerificationRunner, UnslopCheckRunner } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { createMockConfig, createStubContext, initTestDbService, installLintPolicyForTest } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import { GeneralStatus, PortalOperation, SwapClass } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import {
  type IPortalVerification,
  type IUnslopSettings,
  type IVerificationResult,
  PortalVerificationSchema,
  type VerificationStatus,
} from "@exaix/schemas";
import { buildUnslopPortalAssets } from "../../../scripts/build_unslop_portal_bundle.ts";

const STUB_PROVIDER = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

interface IScenarioHandle {
  rootDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanupDb: () => Promise<void>;
  logger: EventLogger;
  reviewRegistry: ReviewRegistry;
  loop: ExecutionLoop;
  traceId: string;
}

async function initPortalRepo(portalDir: string): Promise<void> {
  await ensureDir(portalDir);
  for (
    const args of [
      ["init", "-b", "master"],
      ["config", "user.name", "Test User"],
      ["config", "user.email", "test@test.com"],
    ]
  ) {
    await new Deno.Command("git", { args, cwd: portalDir }).output();
  }
  await Deno.writeTextFile(join(portalDir, ".gitignore"), "*.tmp\n");
  await new Deno.Command("git", { args: ["add", ".gitignore"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "Initial commit"], cwd: portalDir }).output();
}

function planWithAction(traceId: string, requestId: string, actionToml: string, agentRole?: string): string {
  return `---
trace_id: "${traceId}"
request_id: ${requestId}
status: ${PlanStatus.APPROVED}
portal: my-portal
${agentRole ? `agent_role: ${agentRole}\n` : ""}---

# Verification Plan

\`\`\`toml
${actionToml}
\`\`\`
`;
}

function writeAction(path: string, content: string): string {
  return `tool = "write_file"
description = "write ${path}"

[params]
path = "${path}"
content = """
${content}"""
`;
}

async function makeVerificationLoop(options: {
  prefix: string;
  verification?: IPortalVerification;
  planAction: string;
  requestId: string;
  readOnlyAgent?: boolean;
  factory?: (logger: IEventLogger, knownSecrets: readonly string[]) => IVerificationRunner;
  unslop?: boolean;
  lintPolicy?: boolean;
  unslopSettings?: Partial<IUnslopSettings>;
  effectiveConfigDb?: boolean;
  baseCatalog?: boolean;
  llmProvider?: unknown;
  onCodeChangesDelegate?: unknown;
  knownSecrets?: readonly string[];
}): Promise<IScenarioHandle> {
  const rootDir = await Deno.makeTempDir({ prefix: options.prefix });
  const portalDir = join(rootDir, "my-portal");
  await initPortalRepo(portalDir);
  if (options.baseCatalog) {
    await Deno.writeTextFile(join(portalDir, "catalog.json"), JSON.stringify(singleRulePolicy()));
    await new Deno.Command("git", { args: ["add", "catalog.json"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["commit", "-m", "base policy"], cwd: portalDir }).output();
  }

  if (options.readOnlyAgent) {
    const blueprintsDir = pathBuilders.blueprintsPath(rootDir, DEFAULT_AGENTS_PATH);
    await ensureDir(blueprintsDir);
    await Deno.writeTextFile(
      join(blueprintsDir, "code-analyst.md"),
      `---\nagent_role: "code-analyst"\nname: "Code Analyst"\nmodel: "mock:test"\ncapabilities: ["read_file", "list_directory", "grep_search"]\ncreated: "2026-02-04T00:00:00Z"\ncreated_by: "test"\nversion: "1.0.0"\n---\n\n# Code Analyst\n`,
    );
  }

  const { db, cleanup: cleanupDb } = await initTestDbService();
  const traceId = crypto.randomUUID();

  const config = createMockConfig(rootDir, {
    portals: [{
      alias: "my-portal",
      target_path: portalDir,
      default_branch: "master",
      agents_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      ...(options.verification ? { verification: options.verification } : {}),
    }],
  });

  if (options.unslop) {
    const assetDir = options.effectiveConfigDb ? "lint/from-db" : options.unslopSettings?.asset_dir ?? "lint";
    await buildUnslopPortalAssets({
      root: new URL("../../../", import.meta.url).pathname,
      out: join(rootDir, assetDir),
    });
    await ensureDir(join(rootDir, config.paths.runtime));
    if (options.unslopSettings !== undefined) {
      config.verification.unslop = { ...config.verification.unslop, ...options.unslopSettings };
    }
  }

  if (options.lintPolicy) {
    await installLintPolicyForTest(join(rootDir, "lint"));
  }

  const effective = options.effectiveConfigDb ? await realConfigDbContext(rootDir, config, db) : undefined;
  const activeDir = pathBuilders.activePath(join(rootDir, config.paths.workspace));
  await ensureDir(activeDir);

  const logger = new EventLogger({ db, defaultActor: "user:test" });
  const reviewRegistry = new ReviewRegistry(db, logger);
  const loop = new ExecutionLoop({
    config,
    ...(effective ? { context: effective.context } : {}),
    db,
    logger,
    agentRole: "test-agent",
    reviewRegistry,
    ...(options.factory ? { verificationRunnerFactory: options.factory } : {}),
    ...(options.knownSecrets ? { knownSecrets: options.knownSecrets } : {}),
    ...(options.llmProvider ? { llmProvider: options.llmProvider as never } : {}),
    ...(options.onCodeChangesDelegate ? { onCodeChangesDelegate: options.onCodeChangesDelegate as never } : {}),
    gitServiceFactory: {
      createGitService(repoPath: string, trace: string) {
        return new GitService({ config, traceId: trace, agentRole: "test-agent", repoPath });
      },
    },
    toolRegistryFactory: {
      createToolRegistry(trace: string, baseDir: string) {
        return new ToolRegistry({ config, traceId: trace, agentRole: "test-agent", baseDir });
      },
    },
    memoryBank: new MemoryBankService(config, logger),
  });

  const planPath = join(activeDir, `${options.requestId}.md`);
  await Deno.writeTextFile(
    planPath,
    planWithAction(traceId, options.requestId, options.planAction, options.readOnlyAgent ? "code-analyst" : undefined),
  );
  const result = await loop.processTask(planPath);
  assert(result.success, result.error);

  return {
    rootDir,
    db,
    cleanupDb: async () => {
      effective?.close();
      await cleanupDb();
    },
    logger,
    reviewRegistry,
    loop,
    traceId,
  };
}

function completedStatus(db: IScenarioHandle["db"], traceId: string): VerificationStatus {
  const rows = db.getActivitiesByTrace(traceId).filter((row) => row.action_type === "execution.completed");
  assertEquals(rows.length, 1, "expected exactly one execution.completed row");
  return JSON.parse(rows[0].payload).verification_status as VerificationStatus;
}

function verificationEventCount(db: IScenarioHandle["db"], traceId: string): number {
  return db.getActivitiesByTrace(traceId).filter((row) => row.action_type.startsWith("execution.verification.")).length;
}

Deno.test("[execution-verification] a portal without verification completes with verification_status not_configured", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-none-",
    planAction: writeAction("pass_test.ts", 'Deno.test("ok", () => {});\n'),
    requestId: "verify-none",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "not_configured");
    assertEquals(verificationEventCount(handle.db, handle.traceId), 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a passing check completes with verification_status passed and a registered review", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-pass-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: writeAction("pass_test.ts", 'Deno.test("ok", () => { if (1 !== 1) throw new Error("no"); });\n'),
    requestId: "verify-pass",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "passed");
    const events = handle.db.getActivitiesByTrace(handle.traceId).map((row) => row.action_type);
    assert(events.includes("execution.verification.started"), events.join(","));
    assert(events.includes("execution.verification.passed"), events.join(","));
    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a failing check still registers the review and completes with verification_status failed", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-fail-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: writeAction("fail_test.ts", 'Deno.test("fail", () => { throw new Error("boom"); });\n'),
    requestId: "verify-fail",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const events = handle.db.getActivitiesByTrace(handle.traceId).map((row) => row.action_type);
    assert(events.includes("execution.verification.failed"), events.join(","));
    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a timed-out check completes with verification_status error and no repair", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-error-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "deno_task", task: "test" }],
      check_timeout_ms: 700,
    }),
    planAction: writeAction(
      "slow_test.ts",
      'Deno.test("slow", async () => { await new Promise((r) => setTimeout(r, 10000)); });\n',
    ),
    requestId: "verify-error",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "error");
    const events = handle.db.getActivitiesByTrace(handle.traceId).map((row) => row.action_type);
    assertFalse(events.includes("execution.repair.started"));
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a configured portal with no commit completes as skipped", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-skip-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: 'tool = "read_file"\ndescription = "read only"\n\n[params]\npath = ".gitignore"\n',
    requestId: "verify-skip",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "skipped");
    assertEquals(verificationEventCount(handle.db, handle.traceId), 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a read-only plan never runs checks and completes as skipped", async () => {
  let factoryCalled = false;
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-readonly-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: 'tool = "read_file"\ndescription = "read only"\n\n[params]\npath = ".gitignore"\n',
    requestId: "verify-readonly",
    readOnlyAgent: true,
    factory: () => {
      factoryCalled = true;
      return { run: () => Promise.resolve({ passed: true, error: false, failures: [] }) };
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "skipped");
    assertEquals(factoryCalled, false);
    assertEquals(verificationEventCount(handle.db, handle.traceId), 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a fake verificationRunnerFactory drives the status without spawning deno", async () => {
  let calls = 0;
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-factory-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: writeAction("pass_test.ts", 'Deno.test("ok", () => {});\n'),
    requestId: "verify-factory",
    factory: () => {
      calls++;
      return {
        run: () => Promise.resolve({ passed: true, error: false, failures: [] }),
      };
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "passed");
    assertEquals(calls, 1);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a verification runner that throws completes as error with a registered review and the worktree kept", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-throw-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_task", task: "test" }] }),
    planAction: writeAction("pass_test.ts", 'Deno.test("ok", () => {});\n'),
    requestId: "verify-throw",
    factory: () => ({ run: () => Promise.reject(new Error("runner exploded")) }),
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "error");
    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1, "the review must be registered on the committed work");
    const worktree = pathBuilders.runtimePath(handle.rootDir, "worktrees", "my-portal", handle.traceId);
    assert(await exists(worktree), "the worktree must be kept");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a real unslop failure is repaired by the bounded repair loop", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-unslop-repair-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop" }],
      max_repair_attempts: 1,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-unslop-repair",
    unslop: true,
    llmProvider: STUB_PROVIDER,
    onCodeChangesDelegate: async (
      _trace: string,
      _step: unknown,
      worktreePath: string,
    ) => {
      await Deno.writeTextFile(join(worktreePath, "seed.ts"), "export const seed = 1;\n");
      return "changes_made" as const;
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "repaired");
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    const lintChecks = rows.filter((row) => row.action_type === "execution.verification.lint_check.completed");
    assert(lintChecks.length >= 2, "the adapter ran before and after the repair");
    const last = JSON.parse(lintChecks.at(-1)!.payload) as Record<string, unknown>;
    assertEquals(last.outcome, "passed");
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].verification_status, "repaired");
    assertEquals(snapshots[0].total, 0);
    assertEquals(snapshots[0].findings, []);
    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] a real deno_lint failure is repaired by the bounded repair loop", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-deno-lint-repair-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "deno_lint" }],
      max_repair_attempts: 1,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-deno-lint-repair",
    lintPolicy: true,
    llmProvider: STUB_PROVIDER,
    onCodeChangesDelegate: async (
      _trace: string,
      _step: unknown,
      worktreePath: string,
    ) => {
      await Deno.writeTextFile(join(worktreePath, "seed.ts"), "export const seed = 1;\n");
      return "changes_made" as const;
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "repaired");
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    const started = rows.filter((row) => row.action_type === "execution.verification.lint_check.started");
    const completed = rows.filter((row) => row.action_type === "execution.verification.lint_check.completed");
    assertEquals(started.length, 2, "the runner ran before and after the repair");
    assertEquals(completed.length, 2);
    const first = JSON.parse(completed[0].payload) as Record<string, unknown>;
    const last = JSON.parse(completed.at(-1)!.payload) as Record<string, unknown>;
    assertEquals(first.outcome, "failed");
    assertEquals(last.outcome, "passed");
    assertEquals(first.check_index, 0);
    assert(typeof first.target_sha === "string" && first.target_sha.length === 40);
    for (const row of [...started, ...completed]) {
      assertEquals(row.trace_id, handle.traceId);
    }
    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("opt-out-still-event-free: an opted-out portal journals no unslop lifecycle event", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-unslop-off-",
    planAction: writeAction("pass_test.ts", 'Deno.test("ok", () => {});\n'),
    requestId: "verify-unslop-off",
    factory: () => {
      throw new Error("opt-out must not construct a verification runner");
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "not_configured");
    const lintEvents = handle.db.getActivitiesByTrace(handle.traceId)
      .filter((row) => row.action_type.startsWith("execution.verification.lint"));
    assertEquals(lintEvents.length, 0);
    assertEquals(
      JSON.parse(
        handle.db.getActivitiesByTrace(handle.traceId)
          .find((row) => row.action_type === "execution.completed")!.payload,
      ).verification_run_id,
      undefined,
    );
    assertEquals(await exists(join(handle.rootDir, "lint")), false);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-verification] the default factory applies the resolved unslop asset directory", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-unslop-settings-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop" }],
      max_repair_attempts: 0,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-unslop-settings",
    unslop: true,
    unslopSettings: { asset_dir: "lint/alternate", findings_limit: 1 },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    const completed = rows.filter((row) => row.action_type === "execution.verification.lint_check.completed");
    assertEquals(completed.length, 1);
    const payload = JSON.parse(completed[0].payload) as Record<string, unknown>;
    assertEquals(payload.outcome, "failed");
    assert(typeof payload.total === "number" && payload.total > 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

/** Parsed terminal lint snapshots on one trace. */
function lintSnapshots(
  db: IScenarioHandle["db"],
  traceId: string,
): Array<Record<string, unknown>> {
  return db.getActivitiesByTrace(traceId)
    .filter((row) => row.action_type === "execution.verification.lint_findings")
    .map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

Deno.test("terminal-attempt-matrix", async () => {
  const zeroRepair = await makeVerificationLoop({
    prefix: "exec-verif-unslop-zero-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop" }],
      max_repair_attempts: 0,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-unslop-zero",
    unslop: true,
  });
  try {
    await zeroRepair.db.waitForFlush();
    assertEquals(completedStatus(zeroRepair.db, zeroRepair.traceId), "failed");
    const snapshots = lintSnapshots(zeroRepair.db, zeroRepair.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].verification_status, "failed");
    assert(typeof snapshots[0].total === "number" && (snapshots[0].total as number) > 0);
    const checks = snapshots[0].checks as Array<Record<string, unknown>>;
    assertEquals(checks.length, 1);
    assertEquals(checks[0].outcome, "failed");
    const completed = zeroRepair.db.getActivitiesByTrace(zeroRepair.traceId)
      .filter((row) => row.action_type === "execution.completed");
    assertEquals(completed.length, 1);
    assertEquals(JSON.parse(completed[0].payload).verification_run_id, snapshots[0].run_id);
  } finally {
    await zeroRepair.cleanupDb();
    await Deno.remove(zeroRepair.rootDir, { recursive: true });
  }

  const twoChecks = await makeVerificationLoop({
    prefix: "exec-verif-unslop-two-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop" }, { kind: "unslop", include: ["other.ts"] }],
      max_repair_attempts: 0,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-unslop-two",
    unslop: true,
  });
  try {
    await twoChecks.db.waitForFlush();
    const snapshots = lintSnapshots(twoChecks.db, twoChecks.traceId);
    assertEquals(snapshots.length, 1);
    const checks = snapshots[0].checks as Array<Record<string, unknown>>;
    assertEquals(checks.length, 2);
    assertEquals(checks[0].outcome, "failed");
    assertEquals(checks[1].outcome, "passed");
    assertEquals(snapshots[0].total, checks[0].total);
  } finally {
    await twoChecks.cleanupDb();
    await Deno.remove(twoChecks.rootDir, { recursive: true });
  }
});

Deno.test("same-trace-run-identity", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-unslop-trace-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop" }],
      max_repair_attempts: 0,
    }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-unslop-first",
    unslop: true,
  });
  try {
    await Deno.remove(join(handle.rootDir, ".exa", "worktrees"), { recursive: true }).catch(() => {});
    await new Deno.Command("git", { args: ["worktree", "prune"], cwd: join(handle.rootDir, "my-portal") }).output();
    const secondPlanPath = join(handle.rootDir, "Workspace", "Active", "verify-unslop-second.md");
    await ensureDir(join(handle.rootDir, "Workspace", "Active"));
    await Deno.writeTextFile(
      secondPlanPath,
      planWithAction(handle.traceId, "verify-unslop-second", writeAction("other.ts", "export const other = 1;\n")),
    );
    const second = await handle.loop.processTask(secondPlanPath);
    assert(second.success, second.error);
    await handle.db.waitForFlush();

    const completed = handle.db.getActivitiesByTrace(handle.traceId)
      .filter((row) => row.action_type === "execution.completed")
      .map((row) => JSON.parse(row.payload) as Record<string, unknown>);
    assertEquals(completed.length, 2);
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 2);
    assertEquals(new Set(completed.map((row) => row.verification_run_id)).size, 2);
    assertEquals(
      new Set(completed.map((row) => row.verification_run_id)).size,
      new Set(snapshots.map((row) => row.run_id)).size,
    );
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("snapshot-error-keeps-review", async () => {
  const original = UnslopCheckRunner.prototype.run;
  let targetSha: string | null = null;
  const run = stub(UnslopCheckRunner.prototype, "run", async function (context) {
    targetSha = context.targetSha;
    await Deno.writeTextFile(join(context.executionRoot, "seed.ts"), "export const seed = 1;\n");
    return await original.call(this, context);
  });
  try {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-snapshot-",
      verification: PortalVerificationSchema.parse({ checks: [{ kind: "unslop" }], max_repair_attempts: 0 }),
      planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
      requestId: "verify-snapshot-error",
      unslop: true,
    });
    try {
      await handle.db.waitForFlush();
      assertEquals(completedStatus(handle.db, handle.traceId), "error");
      const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
      assertEquals(reviews.length, 1);
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      assertEquals(snapshots[0].commit_sha, targetSha);
      assertEquals(snapshots[0].verification_status, "error");
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  } finally {
    run.restore();
  }
});

Deno.test("snapshot-head-drift-keeps-review", async () => {
  let targetSha: string | null = null;
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-head-drift-",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "unslop" }], max_repair_attempts: 0 }),
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-head-drift",
    factory: () => ({
      run: async (_config, context) => {
        const bound = context.unslop;
        assert(bound !== undefined);
        targetSha = bound.targetSha;
        await Deno.writeTextFile(join(context.executionRoot, "other.txt"), "concurrent commit\n");
        await bound.git.runGitCommand(["add", "-A"]);
        await bound.git.runGitCommand(["commit", "-m", "concurrent change"]);
        return { passed: true, error: false, failures: [] };
      },
    }),
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "error");
    assertEquals((await handle.reviewRegistry.list({ portal: "my-portal" })).length, 1);
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].commit_sha, targetSha);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("configured-unslop-skipped-snapshot", async (test) => {
  for (const readOnlyAgent of [false, true]) {
    await test.step(readOnlyAgent ? "read-only" : "no commit", async () => {
      const handle = await makeVerificationLoop({
        prefix: "exec-verif-unslop-skipped-",
        verification: PortalVerificationSchema.parse({ checks: [{ kind: "unslop" }] }),
        planAction: 'tool = "read_file"\ndescription = "read only"\n\n[params]\npath = ".gitignore"\n',
        requestId: "verify-unslop-skipped",
        readOnlyAgent,
        factory: () => {
          throw new Error("skipped run must not construct an adapter");
        },
      });
      try {
        await handle.db.waitForFlush();
        assertEquals(completedStatus(handle.db, handle.traceId), "skipped");
        const snapshots = lintSnapshots(handle.db, handle.traceId);
        assertEquals(snapshots.length, 1);
        assertEquals(snapshots[0].verification_status, "skipped");
        assertEquals(snapshots[0].commit_sha, null);
        assertEquals(snapshots[0].total, null);
        assertEquals(snapshots[0].findings, []);
        assertEquals(snapshots[0].checks, [{ check_index: 0, outcome: "not_run", total: null, error_class: null }]);
        const completed = handle.db.getActivitiesByTrace(handle.traceId)
          .find((row) => row.action_type === "execution.completed");
        assert(completed !== undefined);
        assertEquals(JSON.parse(completed.payload).verification_run_id, snapshots[0].run_id);
        assertEquals(await exists(join(handle.rootDir, "lint")), false);
      } finally {
        await handle.cleanupDb();
        await Deno.remove(handle.rootDir, { recursive: true });
      }
    });
  }
});

type VerificationFixtureOutcome = "passed" | "failed" | "error";

function fixtureVerificationResult(outcome: VerificationFixtureOutcome, file: string): IVerificationResult {
  return {
    passed: outcome === "passed",
    error: outcome === "error",
    failures: outcome === "passed" ? [] : [{
      check: "unslop",
      exit_code: outcome === "failed" ? 1 : null,
      output: "seed.ts:1 unslop/no-chained-type-assertions",
    }],
    lint_checks: [{
      check_index: 0,
      outcome: outcome === "error"
        ? GeneralStatus.ERROR
        : outcome === "failed"
        ? GeneralStatus.FAILED
        : GeneralStatus.PASSED,
      total: outcome === "error" ? null : outcome === "failed" ? 1 : 0,
      error_class: outcome === "error" ? "UnslopEngineMissing" : null,
    }],
    lint_findings: outcome === "failed"
      ? [{ check_index: 0, file, line: 1, rule: "unslop/no-chained-type-assertions" }]
      : [],
  };
}

Deno.test("terminal-run-exit-matrix", async (test) => {
  const cases = ["failure", "error", "unknown attempt", "failed repair", "different failure"] as const;
  for (const name of cases) {
    await test.step(name, async () => {
      let calls = 0;
      const handle = await makeVerificationLoop({
        prefix: "exec-verif-terminal-",
        verification: PortalVerificationSchema.parse({
          checks: [{ kind: "unslop" }],
          max_repair_attempts: name === "failure" || name === "error" ? 0 : 1,
        }),
        planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
        requestId: "verify-terminal",
        llmProvider: STUB_PROVIDER,
        factory: () => ({
          run: () => {
            calls++;
            if (name === "unknown attempt" && calls > 1) return Promise.reject(new Error("unknown attempt"));
            return Promise.resolve(
              fixtureVerificationResult(name === "error" ? "error" : "failed", calls > 1 ? "other.ts" : "seed.ts"),
            );
          },
        }),
        onCodeChangesDelegate: async (_trace: string, _step: unknown, root: string) => {
          if (name === "failed repair") throw new Error("repair failed");
          await Deno.writeTextFile(join(root, "other.ts"), "export const other = 1;\n");
          return "changes_made" as const;
        },
      });
      try {
        await handle.db.waitForFlush();
        const snapshots = lintSnapshots(handle.db, handle.traceId);
        assertEquals(snapshots.length, 1);
        const expected = name === "error" || name === "unknown attempt" ? "error" : "failed";
        assertEquals(completedStatus(handle.db, handle.traceId), expected);
        assertEquals(snapshots[0].verification_status, expected);
        const findings = snapshots[0].findings as Array<{ file: string }>;
        assertEquals(
          findings.map((finding) => finding.file),
          expected === "error" ? [] : [name === "different failure" ? "other.ts" : "seed.ts"],
        );
        assertEquals(snapshots[0].total, expected === "error" ? null : 1);
      } finally {
        await handle.cleanupDb();
        await Deno.remove(handle.rootDir, { recursive: true });
      }
    });
  }
});

/** A complete legacy policy with one independently observable cast rule. */
function singleRulePolicy(): Record<string, unknown> {
  return {
    version: "1",
    scopes: { test: [], fixture: [] },
    tagVocabulary: { safety: { description: "Type safety" } },
    rules: {
      "unslop/no-chained-type-assertions": { engine: "plugin", severity: "error", scope: "all", tags: ["safety"] },
    },
  };
}

/** Loads real TOML and boots a daemon adapter from a migrated and seeded Config DB. */
async function realConfigDbContext(root: string, config: Config, db: IScenarioHandle["db"]) {
  const path = join(root, "exa.config.toml");
  await Deno.writeTextFile(path, stringifyToml(config));
  const service = new ConfigService(path);
  const configDb = new Database(ensureConfigDb(root));
  migrateConfigDb(configDb);
  seedConfigDb(configDb);
  insertOverride(configDb, "verification.unslop.asset_dir", "lint/from-db", "cli", SwapClass.RESTART);
  insertOverride(configDb, "verification.unslop.findings_limit", 1, "cli", SwapClass.RESTART);
  const store = new InMemoryConfigStore();
  for (const [key, value] of getAllEffectiveValues(configDb)) store.set(key, value, SwapClass.RESTART);
  const adapter = new DaemonConfigAdapter(store, configDb);
  assertEquals(service.get().verification.unslop.findings_limit, 2);
  assertEquals(adapter.getOverride("verification.unslop.findings_limit"), 1);
  return {
    context: { ...createStubContext({ config: service, db }), configAdapter: adapter },
    close: () => configDb.close(),
  };
}

Deno.test("effective-config-db-through-default-factory / new-event-inventory-reconciliation", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-config-db-",
    requestId: "verify-config-db",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "unslop" }], max_repair_attempts: 0 }),
    unslop: true,
    effectiveConfigDb: true,
    unslopSettings: { asset_dir: "lint/from-toml", findings_limit: 2 },
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
  });
  try {
    await handle.db.waitForFlush();
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    const completion = rows.find((row) => row.action_type === "execution.completed");
    assert(completion !== undefined);
    const completed = JSON.parse(completion.payload);
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    const snapshot = snapshots[0];
    assertEquals(snapshot.total, 4);
    assertEquals((snapshot.findings as unknown[]).length, 1);
    assertEquals(snapshot.truncated, true);
    assertEquals(snapshot.commit_sha, completed.commit_sha);
    assertEquals(snapshot.run_id, completed.verification_run_id);
    for (
      const action of [
        "execution.verification.lint_check.started",
        "execution.verification.lint_check.completed",
        "execution.verification.lint_findings",
      ]
    ) {
      const events = rows.filter((row) => row.action_type === action);
      assertEquals(events.length, 1, action);
      assertEquals(events[0].trace_id, handle.traceId);
      const payload = JSON.parse(events[0].payload);
      assertEquals(payload.request_id, "verify-config-db");
      assertEquals(payload.run_id, completed.verification_run_id);
      assertEquals(payload.attempt, 0);
      if (action.endsWith("lint_findings")) assertEquals(payload.verification_status, "failed");
      else {
        assertEquals(payload.check_index, 0);
        assertEquals(payload.target_sha, completed.commit_sha);
      }
      if (action.endsWith("lint_check.completed")) {
        assertEquals(payload.outcome, "failed");
        assertEquals(payload.total, 4);
        assertEquals(payload.error_class, null);
      }
    }
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("complete-adapter-and-repair-matrix: original base survives repair policy tamper and introduced files", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-policy-repair-",
    requestId: "verify-policy-repair",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "unslop", catalog: "catalog.json" }],
      max_repair_attempts: 1,
    }),
    unslop: true,
    baseCatalog: true,
    llmProvider: STUB_PROVIDER,
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    onCodeChangesDelegate: async (_trace: string, _step: unknown, root: string) => {
      await Deno.writeTextFile(join(root, "seed.ts"), "export const seed = 1;\n");
      await Deno.writeTextFile(join(root, "introduced.ts"), "export const introduced = 1 as unknown as string;\n");
      await Deno.writeTextFile(
        join(root, "catalog.json"),
        JSON.stringify({ version: "1", scopes: { test: [], fixture: [] }, tagVocabulary: {}, rules: {} }),
      );
      return "changes_made" as const;
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].attempt, 1);
    assertEquals(snapshots[0].total, 1);
    assertEquals((snapshots[0].findings as Array<{ file: string }>).map((finding) => finding.file), ["introduced.ts"]);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("complete-adapter-and-repair-matrix: repair suppression stops mixed checks without stale findings", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-suppression-repair-",
    requestId: "verify-suppression-repair",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "deno_task", task: "fmt" }, { kind: "unslop" }, { kind: "unslop" }],
      max_repair_attempts: 1,
    }),
    unslop: true,
    llmProvider: STUB_PROVIDER,
    planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
    onCodeChangesDelegate: async (_trace: string, _step: unknown, root: string) => {
      await Deno.writeTextFile(
        join(root, "seed.ts"),
        "// deno-lint-ignore-file\nexport const seed = 1 as unknown as string;\n",
      );
      return "changes_made" as const;
    },
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "error");
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].attempt, 1);
    assertEquals(snapshots[0].total, null);
    assertEquals(snapshots[0].findings, []);
    assertEquals(snapshots[0].checks, [
      { check_index: 1, outcome: "error", total: null, error_class: "UnslopSuppressionForbidden" },
      { check_index: 2, outcome: "not_run", total: null, error_class: null },
    ]);
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    const terminal = JSON.parse(rows.find((row) => row.action_type === "execution.completed")!.payload);
    assertEquals(terminal.commit_sha, snapshots[0].commit_sha);
    const errors = rows.filter((row) => row.action_type === "execution.verification.lint_check.completed")
      .map((row) => ({ ...row, data: JSON.parse(row.payload) })).filter((row) => row.data.attempt === 1);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].trace_id, handle.traceId);
    assertEquals(errors[0].data.run_id, terminal.verification_run_id);
    assertEquals(errors[0].data.target_sha, terminal.commit_sha);
    assertEquals(errors[0].data.error_class, "UnslopSuppressionForbidden");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("new-event-inventory-reconciliation: a secret file name never reaches a verification event", async () => {
  const sentinel = "secret-token-zz9";
  const handle = await makeVerificationLoop({
    prefix: "exec-secret-sentinel-",
    requestId: "verify-secret-sentinel",
    verification: PortalVerificationSchema.parse({ checks: [{ kind: "unslop" }], max_repair_attempts: 0 }),
    unslop: true,
    knownSecrets: [sentinel],
    planAction: writeAction(`${sentinel}.ts`, "export const seed = 1 as unknown as string;\n"),
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].total, 4);
    assert((snapshots[0].findings as unknown[]).length > 0);
    const rows = handle.db.getActivitiesByTrace(handle.traceId).filter((row) =>
      row.action_type.startsWith("execution.verification.") || row.action_type === "execution.completed"
    );
    for (
      const action of [
        "execution.verification.lint_check.started",
        "execution.verification.lint_check.completed",
        "execution.verification.lint_findings",
      ]
    ) {
      assert(rows.some((row) => row.action_type === action), action);
    }
    for (const row of rows) assertFalse(row.payload.includes(sentinel), row.action_type);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});
