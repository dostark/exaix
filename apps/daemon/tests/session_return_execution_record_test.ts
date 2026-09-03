/**
 * @module SessionReturnExecutionRecordTest
 * @path apps/daemon/tests/session_return_execution_record_test.ts
 * @description GAP-9 (session-delegation surface, Step 22) — an accepted session
 *   return dispatched through the onReconciled handler mints an IExecutionMemory
 *   from the return's own validated fields (summary, paths_touched, decision) plus
 *   the brief's agent_role, then runs the same curated extraction as the plan
 *   path. A rejected return never reaches onReconciled, so it mints nothing.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { SessionBrief, SessionReturn } from "@exaix/schemas/session_delegate.ts";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import { SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import { SessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionReturnWatcher } from "../src/session_return_watcher.ts";
import { createOnReconciledHandler, type IReconciledLogger } from "../src/on_reconciled_dispatcher.ts";

const FIXED_NOW = new Date("2026-06-19T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

interface IRecordedExecutionRecord {
  execution: IExecutionMemory;
}

function makeMockMemoryBank() {
  const created: IRecordedExecutionRecord[] = [];
  return {
    created,
    createExecutionRecord: (execution: IExecutionMemory) => {
      created.push({ execution });
      return Promise.resolve();
    },
  };
}

function makeMockExtractor(candidates: IProposalLearning[]) {
  const proposals: Array<{ learning: IProposalLearning; execution: IExecutionMemory; agentRole: string }> = [];
  return {
    proposals,
    analyzeExecution: (_execution: IExecutionMemory) => Promise.resolve(candidates),
    createProposal: (learning: IProposalLearning, execution: IExecutionMemory, agentRole: string) => {
      proposals.push({ learning, execution, agentRole });
      return Promise.resolve(crypto.randomUUID());
    },
  };
}

function makeMockLogger(): IReconciledLogger {
  return { info: () => {} };
}

function sampleCandidate(): IProposalLearning {
  return {
    id: crypto.randomUUID(),
    created_at: FIXED_NOW.toISOString(),
    source: MemoryBankSource.EXECUTION,
    scope: MemoryScope.PROJECT,
    project: "portal-under-test",
    title: "Delegated session learning",
    description: "A learning extracted from a delegated session.",
    category: LearningCategory.PATTERN,
    tags: [],
    confidence: ConfidenceAssessmentLevel.HIGH,
    quality_score: 0.8,
  };
}

async function makeRig(gate: SessionBrief["gate"] = "code_changes") {
  const sessionDir = await Deno.makeTempDir();
  const workspaceRoot = await Deno.makeTempDir();
  const worktreePath = join(workspaceRoot, "Portals", "portal-under-test");
  await ensureDir(worktreePath);
  const traceId = crypto.randomUUID();

  const service = new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });

  await service.prepareBrief({
    traceId,
    agentRole: "senior-coder",
    gate,
    tool: "claude-code",
    objective: "Fix the rate limiter.",
    artifactRef: traceId,
    permittedPaths: ["src/**"],
    worktreePath,
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
  });

  return { sessionDir, workspaceRoot, worktreePath, traceId };
}

async function dropReturn(
  sessionDir: string,
  traceId: string,
  fields: Partial<SessionReturn> & { decision: SessionReturn["decision"]; summary: string },
): Promise<void> {
  const dir = join(sessionDir, traceId);
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, "return.json"),
    JSON.stringify({
      trace_id: traceId,
      resume_token: "tok",
      paths_touched: [],
      token_stats: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      ...fields,
    }),
  );
}

Deno.test("GAP-9: an accepted session return mints an execution record with real fields and runs curated extraction", async () => {
  const rig = await makeRig();
  try {
    await dropReturn(rig.sessionDir, rig.traceId, {
      decision: "changes_made",
      summary: "Delegated session: validated portal mount paths, fixed the rate limiter.",
      paths_touched: ["src/main.ts", "src/rate_limiter.ts"],
    });

    const memoryBank = makeMockMemoryBank();
    const extractor = makeMockExtractor([sampleCandidate()]);
    const onReconciled = createOnReconciledHandler({
      briefReader: new SessionBriefReader(rig.sessionDir),
      workspaceRoot: rig.workspaceRoot,
      reviewRegistry: { getByTrace: () => Promise.resolve([]), updateStatus: () => Promise.resolve() },
      logger: makeMockLogger(),
      memoryBank,
      extractor,
    });

    const outcome = SessionDelegationOutcomeSchema.parse({
      delegationTraceId: rig.traceId,
      parentTraceId: rig.traceId,
      parentStepId: "code_changes",
      sequence: 1,
      status: "completed",
      decision: "changes_made",
      summary: "Delegated session: validated portal mount paths, fixed the rate limiter.",
      pathsTouched: ["src/main.ts", "src/rate_limiter.ts"],
      tokenStats: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    await onReconciled(outcome);

    assertEquals(memoryBank.created.length, 1, "exactly one execution record must be minted");
    const execution = memoryBank.created[0].execution;
    assertEquals(execution.trace_id, rig.traceId);
    assertEquals(execution.summary, outcome.summary, "the record summary comes from the return");
    assertEquals(
      execution.changes.files_modified,
      ["src/main.ts", "src/rate_limiter.ts"],
      "paths_touched from the return populates the changes record",
    );
    assertEquals(execution.agent_role, "senior-coder", "agent_role comes from the delegating brief");
    assertEquals(execution.portal, "portal-under-test", "portal is derived from the brief's worktree_path");

    assertEquals(extractor.proposals.length, 1, "extraction must produce a Pending proposal from the record");
    assertEquals(extractor.proposals[0].execution.trace_id, rig.traceId);
  } finally {
    await Deno.remove(rig.sessionDir, { recursive: true });
    await Deno.remove(rig.workspaceRoot, { recursive: true });
  }
});

Deno.test("GAP-9: a rejected session return never reaches onReconciled, so no execution record is minted", async () => {
  const rig = await makeRig();
  try {
    // A decision not permitted at this trace's gate is rejected by reconciliation.
    await dropReturn(rig.sessionDir, rig.traceId, {
      decision: "rejected",
      summary: "This should never produce a memory write.",
    });

    const memoryBank = makeMockMemoryBank();
    const extractor = makeMockExtractor([sampleCandidate()]);
    const onReconciled = createOnReconciledHandler({
      briefReader: new SessionBriefReader(rig.sessionDir),
      workspaceRoot: rig.workspaceRoot,
      reviewRegistry: { getByTrace: () => Promise.resolve([]), updateStatus: () => Promise.resolve() },
      logger: makeMockLogger(),
      memoryBank,
      extractor,
    });

    const resultStore = {
      publishAccepted: () => Promise.resolve(),
      publishRejected: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      getRecord: () => Promise.resolve(null),
      markDelivered: () => Promise.resolve(true),
    };
    const processor = new SessionReturnProcessor({
      sessionDir: rig.sessionDir,
      workspaceRoot: rig.workspaceRoot,
      waitStore: {
        park: () => {
          throw new Error("not expected: a rejected return never resumes the wait store");
        },
        resume: () => {
          throw new Error("not expected: a rejected return never resumes the wait store");
        },
        expire: () => Promise.resolve(undefined as never),
        cancel: () => Promise.resolve(undefined as never),
        get: () => Promise.resolve(undefined),
      },
      resultStore,
    });
    const watcher = new SessionReturnWatcher({
      sessionDir: rig.sessionDir,
      processor,
      resultStore,
      logger: { log: () => Promise.resolve() },
      onReconciled,
    });

    await watcher.handleReturnPath(join(rig.sessionDir, rig.traceId, "return.json"));

    assertEquals(memoryBank.created.length, 0, "a rejected return must never mint an execution record");
    assertEquals(extractor.proposals.length, 0, "a rejected return must never run extraction");
  } finally {
    await Deno.remove(rig.sessionDir, { recursive: true });
    await Deno.remove(rig.workspaceRoot, { recursive: true });
  }
});
