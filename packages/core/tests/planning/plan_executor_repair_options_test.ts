/**
 * @module PlanExecutorRepairOptionsTest
 * @path packages/core/tests/planning/plan_executor_repair_options_test.ts
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/execution_loop.ts]
 * @architectural-layer Tests
 * @description Drives a real PlanExecutor in a real git repository to verify the repair-run
 *   options: branch reuse, no completion commit, no amendments, and the trace-scoped
 *   phase label on plan.execution_* events. Each option is opt-in.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig } from "@exaix/testing";
import { PlanExecutor } from "@exaix/core/planning";
import type { IPlanExecutorOptions } from "@exaix/core/planning";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

const TRACE_ID = "repair-options-trace";
const REPAIR_PHASE = "repair";

const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

interface ICapturedEvent {
  action: string;
  payload?: LogMetadata;
  traceId?: string;
}

function capturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, _target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> => {
    captured.push({ action, payload, traceId });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await new Deno.Command("git", { args, cwd }).output();
  return new TextDecoder().decode(result.stdout).trim();
}

async function initRepo(): Promise<string> {
  const repo = await Deno.makeTempDir({ prefix: "plan-exec-repair-" });
  await git(["init", "-b", "work"], repo);
  await git(["config", "user.name", "Test User"], repo);
  await git(["config", "user.email", "test@test.com"], repo);
  await Deno.writeTextFile(join(repo, "README.md"), "seed\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "seed"], repo);
  return repo;
}

function writingDelegate(): IPlanExecutorOptions["onCodeChangesDelegate"] {
  return async (_traceId, _step, worktreePath) => {
    await Deno.writeTextFile(join(worktreePath, "fixed.ts"), "export const fixed = 1;\n");
    return "changes_made";
  };
}

/** Writes a file but abandons the step, so the change is left for the completion commit. */
function abandoningDelegate(): IPlanExecutorOptions["onCodeChangesDelegate"] {
  return async (_traceId, _step, worktreePath) => {
    await Deno.writeTextFile(join(worktreePath, "leftover.ts"), "export const leftover = 1;\n");
    return "abandoned";
  };
}

function throwingDelegate(): IPlanExecutorOptions["onCodeChangesDelegate"] {
  return () => Promise.reject(new Error("repair delegate failed"));
}

const AMENDMENT_CONFIG = {
  amendment: {
    enabled: true,
    threshold: 90,
    expiryMs: 86_400_000,
    hitl_timeout_ms: 300_000,
    on_timeout: "abort" as const,
  },
};

interface IAmendmentProbe {
  shouldAmendCalls: number;
  options: Partial<IPlanExecutorOptions>;
}

/** A confidence scorer that always scores below the threshold and an amendment service that counts calls. */
function amendmentProbe(): IAmendmentProbe {
  const probe: IAmendmentProbe = { shouldAmendCalls: 0, options: {} };
  probe.options = {
    confidenceScorer: { assessQuick: () => ({ score: 0, reasoning: "low" }) } as never,
    amendmentService: {
      shouldAmend: () => {
        probe.shouldAmendCalls++;
        return Promise.resolve(false);
      },
    } as never,
  };
  return probe;
}

async function runExecutor(
  repo: string,
  options: IPlanExecutorOptions,
  captured: ICapturedEvent[] = [],
  configOverrides: Record<string, never> | typeof AMENDMENT_CONFIG = {},
): Promise<{ lastCommitSha: string | null }> {
  const config = createMockConfig(repo, configOverrides);
  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    repo,
    capturingLogger(captured),
    options,
  );
  return await executor.execute(join(repo, "plan.md"), {
    trace_id: TRACE_ID,
    request_id: "repair-options-req",
    agent_role: "test",
    frontmatter: {},
    steps: [{ number: 1, title: "Fix failing verification (attempt 1)", content: "fix it" }],
  });
}

Deno.test("[plan-executor] reuseCurrentBranch skips createBranch and keeps the current branch", async () => {
  const repo = await initRepo();
  try {
    await runExecutor(repo, { onCodeChangesDelegate: writingDelegate(), reuseCurrentBranch: true });
    assertEquals(await git(["branch", "--show-current"], repo), "work");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("[plan-executor] commitCompletion false adds no completion commit", async () => {
  const repo = await initRepo();
  try {
    const result = await runExecutor(repo, {
      onCodeChangesDelegate: abandoningDelegate(),
      reuseCurrentBranch: true,
      commitCompletion: false,
    });
    assertEquals(await git(["log", "--format=%s"], repo), "seed");
    assertEquals(await git(["status", "--porcelain"], repo), "?? leftover.ts");
    assertEquals(result.lastCommitSha, null);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("[plan-executor] disableAmendments suppresses low-confidence and error amendments with amendments enabled", async () => {
  const repo = await initRepo();
  try {
    const lowConfidence = amendmentProbe();
    await runExecutor(
      repo,
      { onCodeChangesDelegate: writingDelegate(), disableAmendments: true, ...lowConfidence.options },
      [],
      AMENDMENT_CONFIG,
    );
    assertEquals(lowConfidence.shouldAmendCalls, 0, "a low-confidence repair step must not consult amendments");

    const onError = amendmentProbe();
    await assertRejects(
      () =>
        runExecutor(
          repo,
          { onCodeChangesDelegate: throwingDelegate(), disableAmendments: true, ...onError.options },
          [],
          AMENDMENT_CONFIG,
        ),
      Error,
      "repair delegate failed",
    );
    assertEquals(onError.shouldAmendCalls, 0, "a failing repair step must not consult amendments");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("[plan-executor] runPhase adds phase to plan.execution_started, _completed and _failed on the request trace", async () => {
  const repo = await initRepo();
  try {
    const captured: ICapturedEvent[] = [];
    await runExecutor(
      repo,
      { onCodeChangesDelegate: writingDelegate(), reuseCurrentBranch: true, runPhase: REPAIR_PHASE },
      captured,
    );
    await assertRejects(() =>
      runExecutor(
        repo,
        { onCodeChangesDelegate: throwingDelegate(), reuseCurrentBranch: true, runPhase: REPAIR_PHASE },
        captured,
      )
    );

    for (
      const action of [
        DomainEventType.PlanExecutionStarted,
        DomainEventType.PlanExecutionCompleted,
        DomainEventType.PlanExecutionFailed,
      ]
    ) {
      const events = captured.filter((event) => event.action === action);
      assert(events.length > 0, `${action} must be emitted`);
      for (const event of events) {
        assertEquals(event.traceId, TRACE_ID, `${action} must be on the request trace`);
        assertEquals(event.payload?.phase, REPAIR_PHASE, `${action} must carry the repair phase`);
      }
    }
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("[plan-executor] the repair options are opt-in: defaults keep branch creation, the completion commit and amendments", async () => {
  const repo = await initRepo();
  try {
    const captured: ICapturedEvent[] = [];
    const probe = amendmentProbe();
    await runExecutor(repo, { onCodeChangesDelegate: writingDelegate(), ...probe.options }, captured, AMENDMENT_CONFIG);

    assert((await git(["branch", "--show-current"], repo)).startsWith("feat/"), "a default run creates a branch");
    assert(probe.shouldAmendCalls > 0, "a default low-confidence step consults amendments");
    const started = captured.find((event) => event.action === DomainEventType.PlanExecutionStarted);
    assertEquals(started?.payload?.phase, undefined, "a default run carries no phase");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }

  const leftoverRepo = await initRepo();
  try {
    await runExecutor(leftoverRepo, { onCodeChangesDelegate: abandoningDelegate() });
    const subject = await git(["log", "-1", "--format=%s"], leftoverRepo);
    assert(subject.startsWith("Complete plan:"), `a default run commits leftover changes; got ${subject}`);
  } finally {
    await Deno.remove(leftoverRepo, { recursive: true });
  }
});
