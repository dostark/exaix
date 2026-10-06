/**
 * @module ExecutionLoopVerificationTest
 * @path packages/execution/tests/execution_loop_verification_test.ts
 * @related-files ["packages/execution/src/execution_loop.ts", "packages/execution/src/verification_runner.ts"]
 * @architectural-layer Tests
 * @description Drives a real ExecutionLoop in a real git worktree to assert the
 *   post-execution verification status and journaled events for not_configured,
 *   passed, failed, error, skipped and read-only cases.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { ExecutionLoop, type IVerificationRunner } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import { PortalOperation } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import { type IPortalVerification, PortalVerificationSchema, type VerificationStatus } from "@exaix/schemas";

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
}): Promise<IScenarioHandle> {
  const rootDir = await Deno.makeTempDir({ prefix: options.prefix });
  const portalDir = join(rootDir, "my-portal");
  await initPortalRepo(portalDir);

  if (options.readOnlyAgent) {
    const blueprintsDir = join(rootDir, "Blueprints", "Agents");
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

  const activeDir = join(rootDir, config.paths.workspace, "Active");
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

  return { rootDir, db, cleanupDb, logger, reviewRegistry, loop, traceId };
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
    assertEquals(events.includes("execution.repair.started"), false);
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
    const worktree = join(handle.rootDir, ".exa", "worktrees", "my-portal", handle.traceId);
    assert(await exists(worktree), "the worktree must be kept");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});
