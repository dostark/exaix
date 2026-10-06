/**
 * @module VerificationSecurityTest
 * @path packages/execution/tests/verification_security_test.ts
 * @related-files ["packages/execution/src/execution_loop.ts", "packages/execution/src/verification_runner.ts"]
 * @architectural-layer Tests
 * @description Security tests for the verification feedback channel: secret redaction
 *   in the repair prompt, no check output in the trace journal, and operator-only
 *   checks that a request or plan cannot add.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { stub } from "@std/testing/mock";
import { ExecutionLoop } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { castAny, createMockConfig, initTestDbService } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { PortalOperation } from "@exaix/core";
import type { IGitService } from "@exaix/core/types";
import { PlanStatus } from "@exaix/core/status";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { type IPortalVerification, PortalVerificationSchema, type VerificationStatus } from "@exaix/schemas";

const REDACTION_MARKER = "[REDACTED]";
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
const CONFIGURED_SECRET = "SECRET-TOKEN-42";

interface IExecutionLoopInternals {
  executeStructuredPlan: (
    plan: { steps: Array<{ content: string }> },
    executionRoot: string,
    gitService: IGitService,
    frontmatter: PlanFrontmatter,
    planPath: string,
    options: {
      reuseCurrentBranch?: boolean;
      commitCompletion?: boolean;
      disableAmendments?: boolean;
      runPhase?: string;
    },
  ) => Promise<{ lastCommitSha: string | null }>;
}

interface ISecurityHandle {
  rootDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanupDb: () => Promise<void>;
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

function planWithTestFile(traceId: string, requestId: string, testBody: string): string {
  return `---
trace_id: "${traceId}"
request_id: ${requestId}
status: ${PlanStatus.APPROVED}
portal: my-portal
---

# Security Plan

\`\`\`toml
tool = "write_file"
description = "write the leaking test"

[params]
path = "leak_test.ts"
content = """
${testBody}"""
\`\`\`
`;
}

async function runSecurityScenario(options: {
  prefix: string;
  verification?: IPortalVerification;
  testBody: string;
  knownSecrets: readonly string[];
  planExtra?: string;
  /** Run the repair through a real PlanExecutor whose delegate writes a file that does not echo the output. */
  realRepair?: boolean;
}): Promise<{ handle: ISecurityHandle; repairContents: string[] }> {
  const rootDir = await Deno.makeTempDir({ prefix: options.prefix });
  const portalDir = join(rootDir, "my-portal");
  await initPortalRepo(portalDir);

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
  const repairContents: string[] = [];

  const logger = new EventLogger({ db, defaultActor: "user:test" });
  const reviewRegistry = new ReviewRegistry(db, logger);
  const loop = new ExecutionLoop({
    config,
    db,
    logger,
    agentRole: "test-agent",
    reviewRegistry,
    knownSecrets: options.knownSecrets,
    ...(options.realRepair
      ? {
        llmProvider: STUB_PROVIDER as never,
        onCodeChangesDelegate: async (_trace: string, step: { content: string }, worktreePath: string) => {
          repairContents.push(step.content);
          await Deno.writeTextFile(join(worktreePath, "fixed.ts"), "export const fixed = 1;\n");
          return "changes_made" as const;
        },
      }
      : {}),
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

  const planPath = join(activeDir, `${options.prefix}.md`);
  const plan = planWithTestFile(traceId, options.prefix, options.testBody) + (options.planExtra ?? "");
  await Deno.writeTextFile(planPath, plan);

  const repairStub = options.realRepair ? undefined : stub(
    castAny<IExecutionLoopInternals>(ExecutionLoop.prototype),
    "executeStructuredPlan",
    (repairPlan: { steps: Array<{ content: string }> }) => {
      repairContents.push(repairPlan.steps[0].content);
      return Promise.resolve({ lastCommitSha: null });
    },
  );

  try {
    const result = await loop.processTask(planPath);
    assert(result.success, result.error);
  } finally {
    repairStub?.restore();
  }

  return { handle: { rootDir, db, cleanupDb, traceId }, repairContents };
}

function completedStatus(db: ISecurityHandle["db"], traceId: string): VerificationStatus {
  const rows = db.getActivitiesByTrace(traceId).filter((row) => row.action_type === "execution.completed");
  return JSON.parse(rows[0].payload).verification_status as VerificationStatus;
}

const TEST_CHECK = PortalVerificationSchema.parse({
  checks: [{ kind: "deno_task", task: "test" }],
  max_repair_attempts: 1,
});

Deno.test("[verification-security] a configured secret value printed by a test is redacted in the repair prompt", async () => {
  const testBody = `Deno.test("leak", () => {
  const parts = ["SECRET", "-TOKEN", "-42"];
  const s = parts.join("");
  console.log(s);
  throw new Error(s);
});
`;
  const { handle, repairContents } = await runSecurityScenario({
    prefix: "verify-secret",
    verification: TEST_CHECK,
    testBody,
    knownSecrets: [CONFIGURED_SECRET],
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(repairContents.length, 1);
    assert(repairContents[0].includes(REDACTION_MARKER), repairContents[0]);
    assertEquals(repairContents[0].includes(CONFIGURED_SECRET), false);
    assert(repairContents[0].includes("untrusted tool output"), repairContents[0]);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[verification-security] a sentinel string printed by a failing test appears in no journal row of the trace when the repair agent runs no tools that echo it", async () => {
  const sentinelParts = '["SENT", "INEL", "-LEAK"]';
  const testBody = `Deno.test("leak", () => {
  const s = ${sentinelParts}.join("");
  console.log(s);
  throw new Error(s);
});
`;
  const { handle } = await runSecurityScenario({
    prefix: "verify-sentinel",
    verification: TEST_CHECK,
    testBody,
    knownSecrets: [],
  });
  try {
    await handle.db.waitForFlush();
    const joinedSentinel = "SENTINEL-LEAK";
    const leaked = handle.db.getActivitiesByTrace(handle.traceId).filter((row) => row.payload.includes(joinedSentinel));
    assertEquals(leaked.length, 0, "the verification stage must not journal check output");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[verification-security] a request or plan cannot add or change verification checks", async () => {
  const injected =
    `\n\`\`\`toml\n[verification]\nchecks = [{ kind = "deno_task", task = "test" }]\nmax_repair_attempts = 5\n\`\`\`\n`;
  const testBody = `Deno.test("ok", () => {});
`;
  const { handle } = await runSecurityScenario({
    prefix: "verify-inject",
    testBody,
    knownSecrets: [],
    planExtra: injected,
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "not_configured");
    const events = handle.db.getActivitiesByTrace(handle.traceId)
      .filter((row) => row.action_type.startsWith("execution.verification."));
    assertEquals(events.length, 0, "a plan cannot start verification checks");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[verification-security] the sentinel appears in no journal row of the trace when a real repair run executes", async () => {
  const sentinelParts = '["REAL", "SENT", "INEL"]';
  const testBody = `Deno.test("leak", () => {
  const s = ${sentinelParts}.join("");
  console.log(s);
  throw new Error(s);
});
`;
  const { handle, repairContents } = await runSecurityScenario({
    prefix: "verify-real-sentinel",
    verification: TEST_CHECK,
    testBody,
    knownSecrets: [],
    realRepair: true,
  });
  try {
    await handle.db.waitForFlush();
    const joinedSentinel = "REALSENTINEL";
    assertEquals(repairContents.length, 1, "the real repair step must run");
    assert(repairContents[0].includes(joinedSentinel), "the repair prompt carries the check output");
    const rows = handle.db.getActivitiesByTrace(handle.traceId);
    assert(rows.some((row) => row.action_type === "plan.execution_completed"), "the repair run must reach the journal");
    const leaked = rows.filter((row) => row.payload.includes(joinedSentinel));
    assertEquals(leaked.map((row) => row.action_type), [], "the real repair run must not journal check output");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});
