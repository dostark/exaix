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
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { ExecutionLoop, type IVerificationRunner } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { createMockConfig, initTestDbService, installLintPolicyForTest } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import { PortalOperation } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import type { ILintSettings } from "@exaix/schemas/config.ts";
import { type IPortalVerification, PortalVerificationSchema, type VerificationStatus } from "@exaix/schemas";

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
  lintPolicy?: boolean;
  lintSettings?: Partial<ILintSettings>;
  llmProvider?: unknown;
  onCodeChangesDelegate?: unknown;
  knownSecrets?: readonly string[];
}): Promise<IScenarioHandle> {
  const rootDir = await Deno.makeTempDir({ prefix: options.prefix });
  const portalDir = join(rootDir, "my-portal");
  await initPortalRepo(portalDir);
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

  if (options.lintPolicy) {
    await installLintPolicyForTest(join(rootDir, "lint"));
  }
  if (options.lintSettings) {
    config.verification.lint = { ...config.verification.lint, ...options.lintSettings };
  }

  const activeDir = pathBuilders.activePath(join(rootDir, config.paths.workspace));
  await ensureDir(activeDir);

  const logger = new EventLogger({ db, defaultActor: "user:test" });
  const reviewRegistry = new ReviewRegistry(db, logger);
  const loop = new ExecutionLoop({
    config,
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

Deno.test("deno-lint-terminal-snapshot", async (test) => {
  await test.step("failed", async () => {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-deno-lint-failed-",
      verification: PortalVerificationSchema.parse({
        checks: [{ kind: "deno_lint" }],
        max_repair_attempts: 0,
      }),
      planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
      requestId: "verify-deno-lint-failed",
      lintPolicy: true,
    });
    try {
      await handle.db.waitForFlush();
      assertEquals(completedStatus(handle.db, handle.traceId), "failed");
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      const completed = JSON.parse(
        handle.db.getActivitiesByTrace(handle.traceId).find((row) => row.action_type === "execution.completed")!
          .payload,
      ) as Record<string, unknown>;
      assertEquals(snapshots[0].verification_status, "failed");
      assertEquals(snapshots[0].run_id, completed.verification_run_id);
      assertEquals(snapshots[0].commit_sha, completed.commit_sha);
      assert((snapshots[0].total as number) > 0);
      assert((snapshots[0].findings as unknown[]).length > 0);
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  });

  await test.step("repaired", async () => {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-deno-lint-repaired-",
      verification: PortalVerificationSchema.parse({
        checks: [{ kind: "deno_lint" }],
        max_repair_attempts: 1,
      }),
      planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
      requestId: "verify-deno-lint-repaired",
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
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      assertEquals(snapshots[0].verification_status, "repaired");
      assertEquals(snapshots[0].total, 0);
      assertEquals(snapshots[0].findings, []);
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  });

  await test.step("error", async () => {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-deno-lint-error-",
      verification: PortalVerificationSchema.parse({
        checks: [{ kind: "deno_lint" }],
        max_repair_attempts: 0,
      }),
      planAction: writeAction("seed.ts", "export const seed = 1 as unknown as string;\n"),
      requestId: "verify-deno-lint-error",
    });
    try {
      await handle.db.waitForFlush();
      assertEquals(completedStatus(handle.db, handle.traceId), "error");
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      assertEquals(snapshots[0].verification_status, "error");
      const checks = snapshots[0].checks as Array<Record<string, unknown>>;
      assertEquals(checks[0].outcome, "error");
      assertEquals(checks[0].error_class, "LintPolicyMissing");
      assertEquals(checks[0].total, null);
      assertEquals(snapshots[0].findings, []);
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  });

  await test.step("skipped", async () => {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-deno-lint-skipped-",
      verification: PortalVerificationSchema.parse({ checks: [{ kind: "deno_lint" }] }),
      planAction: writeAction("seed.ts", "export const seed = 1;\n"),
      requestId: "verify-deno-lint-skipped",
      readOnlyAgent: true,
    });
    try {
      await handle.db.waitForFlush();
      assertEquals(completedStatus(handle.db, handle.traceId), "skipped");
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      assertEquals(snapshots[0].verification_status, "skipped");
      const checks = snapshots[0].checks as Array<Record<string, unknown>>;
      assertEquals(checks[0].outcome, "not_run");
      assertEquals(snapshots[0].total, null);
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  });

  await test.step("truncated", async () => {
    const handle = await makeVerificationLoop({
      prefix: "exec-verif-deno-lint-truncated-",
      verification: PortalVerificationSchema.parse({
        checks: [{ kind: "deno_lint" }],
        max_repair_attempts: 0,
      }),
      planAction: writeAction("seed.ts", "export const s = 1 as unknown as string;\n"),
      requestId: "verify-deno-lint-truncated",
      lintPolicy: true,
      lintSettings: { findings_limit: 1 },
    });
    try {
      await handle.db.waitForFlush();
      assertEquals(completedStatus(handle.db, handle.traceId), "failed");
      const snapshots = lintSnapshots(handle.db, handle.traceId);
      assertEquals(snapshots.length, 1);
      assert((snapshots[0].total as number) > 1);
      assertEquals((snapshots[0].findings as unknown[]).length, 1);
      assertEquals(snapshots[0].truncated, true);
    } finally {
      await handle.cleanupDb();
      await Deno.remove(handle.rootDir, { recursive: true });
    }
  });
});

Deno.test("secret-file-name-not-journaled", async () => {
  const handle = await makeVerificationLoop({
    prefix: "exec-verif-deno-lint-secret-",
    verification: PortalVerificationSchema.parse({
      checks: [{ kind: "deno_lint" }],
      max_repair_attempts: 0,
    }),
    planAction: writeAction("secret-token-abc.ts", "export const seed = 1 as unknown as string;\n"),
    requestId: "verify-deno-lint-secret",
    lintPolicy: true,
    knownSecrets: ["secret-token-abc"],
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const rows = handle.db.getActivitiesByTrace(handle.traceId)
      .filter((row) => row.action_type.startsWith("execution.verification."));
    assert(rows.length > 0);
    for (const row of rows) {
      assertEquals(row.payload.includes("secret-token-abc"), false, row.action_type);
    }
    const snapshots = lintSnapshots(handle.db, handle.traceId);
    assertEquals(snapshots.length, 1);
    assertEquals(JSON.stringify(snapshots[0]).includes("secret-token-abc"), false);
    assert((snapshots[0].findings as unknown[]).length > 0);
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
